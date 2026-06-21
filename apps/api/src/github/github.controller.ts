import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Req,
  Res,
  Headers,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GithubService } from './github.service';
import { AppsService } from '../apps/apps.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

@Controller('github')
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly appsService: AppsService,
  ) {}

  // Returns the GitHub consent URL for the client to redirect the user to.
  @Get('authorize')
  @UseGuards(JwtAuthGuard)
  authorize(@CurrentUser() user: AuthUser) {
    return this.githubService.buildAuthorizeUrl(user.id);
  }

  // GitHub redirects the browser here after consent. No JWT — trust the signed
  // state param. Redirects back to the dashboard when done.
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const { redirectTo } = await this.githubService.handleCallback(code, state);
    res.redirect(redirectTo);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.githubService.getStatus(user.id);
  }

  @Get('repos')
  @UseGuards(JwtAuthGuard)
  repos(@CurrentUser() user: AuthUser) {
    return this.githubService.listRepos(user.id);
  }

  @Get('repos/:owner/:repo/branches')
  @UseGuards(JwtAuthGuard)
  branches(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.listBranches(user.id, owner, repo);
  }

  // Branches for an arbitrary repo URL (Repository URL mode). Uses ls-remote.
  @Get('remote-branches')
  @UseGuards(JwtAuthGuard)
  remoteBranches(@CurrentUser() user: AuthUser, @Query('repoUrl') repoUrl: string) {
    return this.githubService.listRemoteBranches(user.id, repoUrl);
  }

  // Available Frappe framework versions (for the Frappe version selector).
  @Get('frappe-versions')
  @UseGuards(JwtAuthGuard)
  frappeVersions() {
    return this.githubService.listFrappeVersions();
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.githubService.disconnect(user.id);
  }

  // Inbound push webhook from GitHub. Verified via HMAC of the raw body.
  @Post('webhook/:appId')
  @HttpCode(202)
  async webhook(
    @Param('appId') appId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await this.githubService.resolveWebhookDeploy(
      appId,
      event,
      raw,
      signature,
    );
    if (result) {
      await this.appsService.deployByToken(result.appId, { ref: result.ref });
      return { deployed: true, ref: result.ref };
    }
    return { deployed: false };
  }
}
