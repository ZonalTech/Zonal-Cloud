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
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        orgId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
    }

    return user;
  }
}
