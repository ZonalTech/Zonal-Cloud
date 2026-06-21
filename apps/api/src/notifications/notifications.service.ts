import { Injectable } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Create a notification for a user. metadata is optional structured context
  // (e.g. who impersonated, which deployment failed).
  async create(params: {
    userId: string;
    organizationId?: string | null;
    type: NotificationType;
    message: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        organizationId: params.organizationId ?? null,
        type: params.type,
        message: params.message,
        // Nullable Json column: use JsonNull (not JS null) when absent.
        metadata: params.metadata ?? Prisma.JsonNull,
      },
    });
  }

  // Deployment-failure notifications across an org (or all orgs when
  // organizationId is omitted — used by the cross-tenant admin Errors page),
  // newest first. Read or unread; the admin view is observational, not a queue.
  async listDeploymentFailures(organizationId?: string, limit = 100) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        type: 'deployment_failed',
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { email: true } },
      },
    });
    return { notifications };
  }

  // Unread notifications for a user, newest first. Shown on the dashboard until
  // the user clears them.
  async listUnread(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId, readAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { notifications };
  }

  // Today's notifications for a user (read AND unread), newest first, plus the
  // current unread count. The bell shows the whole list — read ones greyed out —
  // and keeps the badge tied to unreadCount, so opening the panel doesn't clear
  // the counter. Scoped to the current calendar day so the panel is a "today"
  // feed: read items linger for the rest of the day rather than being cleared,
  // and roll off naturally once the date turns over. Capped so it stays a feed.
  async listRecent(userId: string, limit = 50) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayWhere = { userId, createdAt: { gte: startOfToday } };
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: todayWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({
        where: { ...todayWhere, readAt: null },
      }),
    ]);
    return { notifications, unreadCount };
  }

  // A user's full deployment-failure history (read AND unread), newest first,
  // for the dashboard Errors page. Unlike listRecent this is NOT limited to
  // today — it's an archive of the user's own failed deploys.
  async listUserDeploymentFailures(userId: string, limit = 100) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId, type: 'deployment_failed' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { notifications };
  }

  // A single notification, scoped to its owner (returns null if not theirs /
  // missing). Read OR unread — the analysis page links here and the user may
  // have cleared it in the meantime.
  async getOne(userId: string, id: string) {
    return this.prisma.notification.findFirst({
      where: { id, userId },
    });
  }

  // Mark a single notification read (scoped to the owner so a user can only
  // clear their own). Returns how many rows changed (0 if not theirs/missing).
  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { cleared: res.count };
  }

  // Mark all of a user's unread notifications read.
  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { cleared: res.count };
  }
}
