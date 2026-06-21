import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as crypto from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const AGENT_TOKEN_PREFIX = 'ztk_';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Accepts EITHER a permanent agent token (Bearer ztk_...) OR a normal JWT.
 *
 * Agent tokens are long-lived and revocable (AgentToken table). When one is
 * presented, the request is authenticated as the superadmin/org that created it,
 * so existing RolesGuard / @CurrentUser() checks work unchanged. Anything else
 * falls through to the standard passport-jwt guard.
 */
@Injectable()
export class AgentOrJwtGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    const bearer =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (bearer && bearer.startsWith(AGENT_TOKEN_PREFIX)) {
      const record = await this.prisma.agentToken.findUnique({
        where: { tokenHash: hashToken(bearer) },
      });
      if (!record || record.revokedAt) {
        throw new UnauthorizedException({
          code: 'INVALID_AGENT_TOKEN',
          message: 'Agent token is invalid or revoked.',
        });
      }
      // Touch lastUsedAt (best-effort, do not block the request).
      this.prisma.agentToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);

      // Shape matches what jwt.strategy returns so downstream code is identical.
      (req as Request & { user: unknown }).user = {
        id: record.userId,
        organizationId: record.organizationId,
        role: record.role,
        email: 'agent@zonal',
        status: 'active',
        isAgent: true,
      };
      return true;
    }

    // Not an agent token — use the normal JWT flow.
    return super.canActivate(context) as Promise<boolean>;
  }
}
