import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from './request-context';

export interface AuditEntry {
  actorUserId?: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    // Fall back to the ambient request context so callers don't have to thread
    // the IP / actor through every layer; an explicit value still wins.
    const ip = entry.ip ?? this.requestContext.ip ?? null;
    const actorUserId =
      entry.actorUserId ?? this.requestContext.userId ?? null;

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: entry.action,
        target: entry.target,
        // Prisma requires Prisma.JsonNull (not JS null) for a nullable Json column.
        metadata: (entry.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ip,
      },
    });
  }
}
