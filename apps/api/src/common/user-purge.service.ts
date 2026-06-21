import { Injectable } from '@nestjs/common';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Hard-deletes a user and the full ownership tree beneath them. The schema has
 * no cascade for most relations, so children are removed explicitly and in
 * order: containers are torn down first, then deployments/apps/projects, the
 * user's own auth records, and finally the user. If the user was the sole member
 * of their org, the (now-empty) org and its quota go too. Audit logs are kept
 * with the actor nulled out so history survives.
 *
 * Shared by the admin "delete user" action and the self-service "delete my
 * account" flow.
 */
@Injectable()
export class UserPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async purge(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        projects: { select: { id: true, apps: { select: { id: true, subdomain: true } } } },
      },
    });
    if (!user) return;

    const projectIds = user.projects.map((p) => p.id);
    const apps = user.projects.flatMap((p) => p.apps);
    const appIds = apps.map((a) => a.id);

    // Best-effort container teardown (outside the DB transaction).
    for (const app of apps) {
      await this.removeContainer(app.subdomain);
    }

    // Last member of the org? Then the org is removed along with the user.
    const orgMembers = await this.prisma.user.count({
      where: { organizationId: user.organizationId },
    });
    const lastMember = orgMembers <= 1;

    await this.prisma.$transaction(async (tx) => {
      if (appIds.length) {
        await tx.deployToken.deleteMany({ where: { appId: { in: appIds } } });
        await tx.envVar.deleteMany({ where: { appId: { in: appIds } } });
        await tx.deployment.deleteMany({ where: { appId: { in: appIds } } });
        await tx.customDomain.deleteMany({ where: { appId: { in: appIds } } });
        await tx.app.deleteMany({ where: { id: { in: appIds } } });
      }
      if (projectIds.length) {
        await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      }
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.githubAccount.deleteMany({ where: { userId } });
      await tx.auditLog.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });

      await tx.user.delete({ where: { id: userId } });

      if (lastMember) {
        await tx.quota.deleteMany({ where: { organizationId: user.organizationId } });
        await tx.organization.delete({ where: { id: user.organizationId } });
      }
    });
  }

  /** Stop and remove a container so its resources are fully released. */
  private async removeContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(`zonal-${subdomain}`);
      await container.remove({ force: true });
    } catch {
      // Container may not exist — ignore.
    }
  }
}
