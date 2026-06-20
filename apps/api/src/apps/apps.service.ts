import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import { CreateAppDto } from './dto/create-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { Observable, Subject } from 'rxjs';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
}

@Injectable()
export class AppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly logStore: LogStoreService,
    private readonly auditService: AuditService,
  ) {}

  async listApps(userId: string, orgId: string) {
    // Find all projects in the org, then all apps in those projects
    const apps = await this.prisma.app.findMany({
      where: {
        project: {
          orgId,
        },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { project: { name: 'asc' } },
    });
    return { apps };
  }

  async createApp(userId: string, orgId: string, dto: CreateAppDto) {
    // Get or create a default project for the org/user
    let project = await this.prisma.project.findFirst({
      where: { orgId, userId },
    });

    if (dto.projectId) {
      project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
      if (!project || project.orgId !== orgId) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
      }
    }

    if (!project) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { org: true } });
      const orgSlug = user?.org?.slug ?? 'default';
      let projectSlug = `${orgSlug}-default`;

      const existing = await this.prisma.project.findUnique({ where: { slug: projectSlug } });
      if (existing) projectSlug = `${projectSlug}-${Date.now()}`;

      project = await this.prisma.project.create({
        data: {
          orgId,
          userId,
          name: 'Default',
          slug: projectSlug,
        },
      });
    }

    // Generate unique subdomain
    const baseSlug = slugify(dto.name);
    let subdomain = baseSlug;
    const existing = await this.prisma.app.findUnique({ where: { subdomain } });
    if (existing) subdomain = `${baseSlug}-${uuidv4().substring(0, 6)}`;

    const app = await this.prisma.app.create({
      data: {
        projectId: project.id,
        name: dto.name,
        type: 'static',
        source: dto.source,
        repoUrl: dto.repoUrl ?? null,
        branch: dto.branch ?? 'main',
        subdomain,
        buildCmd: dto.buildCmd ?? null,
        outputDir: dto.outputDir ?? 'dist',
        status: 'idle',
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.create',
      target: app.id,
      metadata: { name: app.name, source: app.source },
    });

    return { app };
  }

  async getApp(userId: string, orgId: string, appId: string) {
    const app = await this.findAppForOrg(appId, orgId);
    const deployments = await this.prisma.deployment.findMany({
      where: { appId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { app, deployments };
  }

  async deploy(userId: string, orgId: string, appId: string, dto: DeployDto) {
    const app = await this.findAppForOrg(appId, orgId);

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
    });

    await this.auditService.log({
      actorUserId: userId ?? undefined,
      action: 'app.deploy',
      target: appId,
      metadata: { deploymentId: deployment.id, ref: dto.ref },
    });

    return { deployment };
  }

  async deployByToken(appId: string, dto: DeployDto) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
    });

    return { deployment };
  }

  streamLogs(orgId: string, appId: string): Observable<{ data: string }> {
    const subject = new Subject<{ data: string }>();

    // Emit logs asynchronously
    (async () => {
      try {
        // Enforce org ownership before streaming any logs (prevents cross-tenant
        // log access by app id). Throws NotFound if the app is not in this org.
        await this.findAppForOrg(appId, orgId);

        // Get latest deployment for this app
        const latest = await this.prisma.deployment.findFirst({
          where: { appId },
          orderBy: { createdAt: 'desc' },
        });

        if (!latest) {
          subject.next({ data: 'No deployments found for this app' });
          subject.complete();
          return;
        }

        // Send existing logs first
        const existing = await this.logStore.getAll(latest.id);
        for (const line of existing) {
          subject.next({ data: line });
        }

        // Stream new logs if deployment is still building
        if (latest.status === 'queued' || latest.status === 'building') {
          const stream = await this.logStore.tailStream(latest.id);
          for await (const chunk of stream) {
            if (chunk) {
              subject.next({ data: chunk });
            }
          }
        }

        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  async stopApp(userId: string, orgId: string, appId: string) {
    const app = await this.findAppForOrg(appId, orgId);
    await this.stopContainer(app.subdomain);

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.stop',
      target: appId,
    });

    return { app: updated };
  }

  async createToken(userId: string, orgId: string, appId: string, dto: CreateTokenDto) {
    await this.findAppForOrg(appId, orgId);

    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(plainToken, 10);

    const deployToken = await this.prisma.deployToken.create({
      data: {
        appId,
        name: dto.name,
        hashedToken,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'token.create',
      target: appId,
      metadata: { tokenId: deployToken.id, name: dto.name },
    });

    return {
      token: plainToken,
      id: deployToken.id,
      name: deployToken.name,
    };
  }

  async listTokens(userId: string, orgId: string, appId: string) {
    await this.findAppForOrg(appId, orgId);

    const tokens = await this.prisma.deployToken.findMany({
      where: { appId },
      select: { id: true, name: true, lastUsedAt: true },
      orderBy: { name: 'asc' },
    });

    return { tokens };
  }

  private async findAppForOrg(appId: string, orgId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { orgId: true } } },
    });

    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    if (app.project.orgId !== orgId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    return app;
  }

  private async stopContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(`zonal-${subdomain}`);
      await container.stop();
    } catch {
      // Container may not be running — ignore
    }
  }
}
