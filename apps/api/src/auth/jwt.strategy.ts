import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  orgId: string;
  // Present only on impersonation sessions: the admin who started it.
  imp?: { by: string; email: string };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Accept the JWT from the Authorization header for normal requests, and
      // from a `token` query param for SSE endpoints (browser EventSource cannot
      // set custom headers). The query-param path is only usable on routes that
      // opt into it; all routes still verify the signature here.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload) {
    const record = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        organizationId: true,
      },
    });

    if (!record) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    if (record.status === 'suspended') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
    }

    // Controllers read the org id as `user.organizationId` (matching the DB
    // column and refactored AuthUser contract). Expose it under that name —
    // also keep `orgId` as a backwards-compatible alias. Returning only `orgId`
    // (the old behavior) left `user.organizationId` undefined, which made every
    // org-scoped check fail with "Access denied" (e.g. creating a new site).
    const user = { ...record, orgId: record.organizationId };

    // Carry the impersonation marker (if any) onto req.user so the dashboard can
    // surface "you are impersonating" and audit can attribute actions.
    return payload.imp ? { ...user, imp: payload.imp } : user;
  }
}
