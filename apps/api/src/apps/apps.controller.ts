import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Sse,
  MessageEvent,
  Inject,
  forwardRef,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppsService } from './apps.service';
import { GithubService } from '../github/github.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentOrJwtGuard } from '../auth/agent-or-jwt.guard';
import { DeployTokenGuard } from './deploy-token.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { AddDomainDto } from './dto/add-domain.dto';
import { AddFrappeAppDto, SetFrappeVersionDto } from './dto/frappe-app.dto';
import {
  AddNodeRedUserDto,
  UpdateNodeRedUserDto,
} from './dto/nodered-user.dto';
import { Request } from 'express';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

@Controller('apps')
export class AppsController {
  constructor(
    private readonly appsService: AppsService,
    @Inject(forwardRef(() => GithubService))
    private readonly githubService: GithubService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listApps(@CurrentUser() user: AuthUser) {
    return this.appsService.listApps(user.id, user.organizationId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createApp(@CurrentUser() user: AuthUser, @Body() dto: CreateAppDto) {
    const { app, noderedAdminPassword } = await this.appsService.createApp(
      user.id,
      user.organizationId,
      dto,
    );

    // If the app is wired to a connected GitHub repo, install a push webhook so
    // commits auto-deploy. Best-effort: a webhook failure must not block create.
    if (dto.githubRepoFullName) {
      try {
        const { hookId, secret } = await this.githubService.createWebhook(
          user.id,
          dto.githubRepoFullName,
          app.id,
        );
        const updated = await this.appsService.attachWebhook(
          app.id,
          user.organizationId,
          dto.githubRepoFullName,
          hookId,
          secret,
        );
        return { app: updated, webhook: { installed: true } };
      } catch (err) {
        return {
          app,
          webhook: {
            installed: false,
            error: err instanceof Error ? err.message : 'Webhook install failed',
          },
        };
      }
    }

    // noderedAdminPassword is set only for Node-RED apps — returned once so the
    // dashboard can show the seeded admin credentials.
    return { app, noderedAdminPassword };
  }

  @Get(':id')
  @UseGuards(AgentOrJwtGuard)
  getApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.getApp(user.id, user.organizationId, id);
  }

  // Returns what the dashboard needs to log the user into the deployed app as
  // its administrator. For Frappe apps it returns the managed Administrator
  // credentials + the site's login endpoint, so the dashboard can POST them
  // straight to the site (session cookie lands on the app's own origin). For
  // other app types there are no managed credentials, so it returns a plain
  // redirect target. Auth is enforced here via the Bearer token (fetch), so the
  // credentials are never placed in a navigable URL.
  @Get(':id/admin-login')
  @UseGuards(JwtAuthGuard)
  adminLogin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.getAdminLogin(user.id, user.organizationId, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  updateApp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAppDto,
  ) {
    return this.appsService.updateApp(user.id, user.organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.appsService.deleteApp(user.id, user.organizationId, id);

    // Best-effort: remove the GitHub webhook so it stops pinging a dead app.
    if (result.githubRepoFullName && result.githubWebhookId) {
      await this.githubService.deleteWebhook(
        user.id,
        result.githubRepoFullName,
        result.githubWebhookId,
      );
    }

    return { ok: result.ok };
  }

  // Upload a source folder for an upload-type app. The browser sends each file
  // under "files" and a parallel JSON "paths" array (the webkitRelativePath of
  // each file, in the same order) so the server can rebuild the folder tree —
  // multipart only preserves basenames otherwise.
  @Post(':id/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 5000, { limits: { fileSize: 100 * 1024 * 1024 } }))
  uploadSource(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>,
    @Body('paths') pathsJson: string,
  ) {
    let paths: string[];
    try {
      paths = JSON.parse(pathsJson ?? '[]');
    } catch {
      throw new BadRequestException({ code: 'BAD_PATHS', message: 'Invalid paths field' });
    }
    const items = (files ?? []).map((f, i) => ({
      // Prefer the explicit relative path; fall back to the multipart filename.
      relPath: paths[i] ?? f.originalname,
      buffer: f.buffer,
    }));
    return this.appsService.uploadSource(user.id, user.organizationId, id, items);
  }

  @Post(':id/deploy')
  @UseGuards(DeployTokenGuard)
  async deploy(
    @Req() req: Request & { user: AuthUser; deployTokenApp?: string },
    @Param('id') id: string,
    @Body() dto: DeployDto,
  ) {
    const user = req.user;
    // Deploy token path — no organizationId check needed (guard verified token belongs to app)
    if (req.deployTokenApp) {
      return this.appsService.deployByToken(id, dto);
    }
    return this.appsService.deploy(user.id, user.organizationId, id, dto);
  }

  // Migrate = forced clean rebuild + rollback-safe redeploy. If the new build
  // fails to come up, the previous container is restored so the site stays up.
  @Post(':id/migrate')
  @UseGuards(JwtAuthGuard)
  migrate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DeployDto,
  ) {
    return this.appsService.migrate(user.id, user.organizationId, id, dto);
  }

  @Sse(':id/logs')
  @UseGuards(JwtAuthGuard)
  streamLogs(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Observable<MessageEvent> {
    // Emit as the DEFAULT SSE event (no `type`) so the browser's
    // EventSource.onmessage handler receives it. A named `type: 'log'` would
    // only fire an addEventListener('log', ...) listener, which the dashboard
    // does not register — that left the log panel empty.
    return this.appsService.streamLogs(user.organizationId, id).pipe(
      map((event) => ({
        data: event.data,
      })),
    );
  }

  // Full stored log for ONE deployment (for the error-analysis page) — unlike
  // the SSE stream, which always follows the latest deployment.
  @Get(':id/deployments/:deploymentId/log')
  @UseGuards(JwtAuthGuard)
  deploymentLog(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('deploymentId') deploymentId: string,
  ) {
    return this.appsService.getDeploymentLog(user.organizationId, id, deploymentId);
  }

  @Post(':id/stop')
  @UseGuards(JwtAuthGuard)
  stopApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.stopApp(user.id, user.organizationId, id);
  }

  // Cancel an in-progress build: drops the retrying deploy job, kills the
  // in-flight build containers, and resets the app to 'stopped'. The escape
  // hatch for a stuck or unwanted build.
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.cancelApp(user.id, user.organizationId, id);
  }

  // Restart the running container in place (no rebuild). For Node-RED this
  // reloads settings.js + flows from the persistent volume.
  @Post(':id/restart')
  @UseGuards(JwtAuthGuard)
  restartApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.restartApp(user.id, user.organizationId, id);
  }

  // Snapshot of the running container's recent stdout/stderr (the live app's
  // own runtime logs). Non-following — the UI polls/refreshes this.
  @Get(':id/runtime-logs')
  @UseGuards(JwtAuthGuard)
  runtimeLogs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.getRuntimeLogs(user.organizationId, id);
  }

  @Post(':id/tokens')
  @UseGuards(JwtAuthGuard)
  createToken(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTokenDto,
  ) {
    return this.appsService.createToken(user.id, user.organizationId, id, dto);
  }

  @Get(':id/tokens')
  @UseGuards(JwtAuthGuard)
  listTokens(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.listTokens(user.id, user.organizationId, id);
  }

  // ---- Custom domains ----

  @Get(':id/domains')
  @UseGuards(JwtAuthGuard)
  listDomains(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.listDomains(user.organizationId, id);
  }

  @Post(':id/domains')
  @UseGuards(JwtAuthGuard)
  addDomain(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddDomainDto,
  ) {
    return this.appsService.addDomain(user.id, user.organizationId, id, dto);
  }

  @Post(':id/domains/:domainId/verify')
  @UseGuards(JwtAuthGuard)
  verifyDomain(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
  ) {
    return this.appsService.verifyDomain(user.id, user.organizationId, id, domainId);
  }

  @Delete(':id/domains/:domainId')
  @UseGuards(JwtAuthGuard)
  removeDomain(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('domainId') domainId: string,
  ) {
    return this.appsService.removeDomain(user.id, user.organizationId, id, domainId);
  }

  // ---- Frappe bench apps (type = frappe) ----

  @Get(':id/frappe-apps')
  @UseGuards(JwtAuthGuard)
  listFrappeApps(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.listFrappeApps(user.organizationId, id);
  }

  @Post(':id/frappe-apps')
  @UseGuards(JwtAuthGuard)
  addFrappeApp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddFrappeAppDto,
  ) {
    return this.appsService.addFrappeApp(user.id, user.organizationId, id, dto);
  }

  @Delete(':id/frappe-apps/:frappeAppId')
  @UseGuards(JwtAuthGuard)
  removeFrappeApp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('frappeAppId') frappeAppId: string,
  ) {
    return this.appsService.removeFrappeApp(
      user.id,
      user.organizationId,
      id,
      frappeAppId,
    );
  }

  // Set/upgrade the Frappe framework version the bench is built on. Applied on
  // the next deploy.
  @Post(':id/frappe-version')
  @UseGuards(JwtAuthGuard)
  setFrappeVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetFrappeVersionDto,
  ) {
    return this.appsService.setFrappeVersion(user.id, user.organizationId, id, dto);
  }

  // ---- Node-RED editor accounts (type = nodered) ----

  @Get(':id/nodered-users')
  @UseGuards(JwtAuthGuard)
  listNodeRedUsers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.listNodeRedUsers(user.organizationId, id);
  }

  @Post(':id/nodered-users')
  @UseGuards(JwtAuthGuard)
  addNodeRedUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddNodeRedUserDto,
  ) {
    return this.appsService.addNodeRedUser(user.id, user.organizationId, id, dto);
  }

  @Patch(':id/nodered-users/:nodeRedUserId')
  @UseGuards(JwtAuthGuard)
  updateNodeRedUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('nodeRedUserId') nodeRedUserId: string,
    @Body() dto: UpdateNodeRedUserDto,
  ) {
    return this.appsService.updateNodeRedUser(
      user.id,
      user.organizationId,
      id,
      nodeRedUserId,
      dto,
    );
  }

  @Delete(':id/nodered-users/:nodeRedUserId')
  @UseGuards(JwtAuthGuard)
  removeNodeRedUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('nodeRedUserId') nodeRedUserId: string,
  ) {
    return this.appsService.removeNodeRedUser(
      user.id,
      user.organizationId,
      id,
      nodeRedUserId,
    );
  }
}
