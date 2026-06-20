import { Injectable, NotFoundException } from '@nestjs/common';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { AuditService } from '../common/audit.service';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  orgId: true,
  createdAt: true,
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly auditService: AuditService,
  ) {}

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return { users };
  }

  async suspendUser(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'suspended' },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.suspend',
      target: userId,
    });

    return { user: updated };
  }

  async updateRole(actorId: string, userId: string, dto: UpdateRoleDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.role',
      target: userId,
      metadata: { role: dto.role },
    });

    return { user: updated };
  }

  async listOrgs() {
    const orgs = await this.prisma.org.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { orgs };
  }

  async updateQuota(actorId: string, orgId: string, dto: UpdateQuotaDto) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Org not found' });

    const quota = await this.prisma.quota.upsert({
      where: { orgId },
      create: {
        orgId,
        maxApps: dto.maxApps ?? 5,
        cpu: dto.cpu ?? '1',
        memory: dto.memory ?? '512m',
        disk: dto.disk ?? '5g',
        buildMinutes: dto.buildMinutes ?? 60,
        maxConcurrentDeploys: dto.maxConcurrentDeploys ?? 2,
      },
      update: {
        ...(dto.maxApps !== undefined && { maxApps: dto.maxApps }),
        ...(dto.cpu !== undefined && { cpu: dto.cpu }),
        ...(dto.memory !== undefined && { memory: dto.memory }),
        ...(dto.disk !== undefined && { disk: dto.disk }),
        ...(dto.buildMinutes !== undefined && { buildMinutes: dto.buildMinutes }),
        ...(dto.maxConcurrentDeploys !== undefined && { maxConcurrentDeploys: dto.maxConcurrentDeploys }),
      },
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'org.quota',
      target: orgId,
      metadata: dto as Record<string, unknown>,
    });

    return { quota };
  }

  async listAllApps() {
    const apps = await this.prisma.app.findMany({
      include: { project: { select: { orgId: true, name: true } } },
      orderBy: { project: { name: 'asc' } },
    });
    return { apps };
  }

  async adminStopApp(actorId: string, appId: string) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });

    await this.stopContainer(app.subdomain);

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'admin.app.stop',
      target: appId,
    });

    return { app: updated };
  }

  async getMetrics() {
    const [users, orgs, apps, deployments, queueDepth] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.org.count(),
      this.prisma.app.count(),
      this.prisma.deployment.count(),
      this.deployService.getQueueDepth(),
    ]);

    return { users, orgs, apps, deployments, queueDepth };
  }

  async getAuditLogs() {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { logs };
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
