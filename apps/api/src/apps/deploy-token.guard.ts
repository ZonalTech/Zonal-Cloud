import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Guard for the deploy endpoint.
 * Accepts either a valid JWT or a deploy token for the target app.
 * Sets request.user and request.deployTokenApp when a deploy token is used.
 */
@Injectable()
export class DeployTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers['authorization'] ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing Bearer token' });
    }

    const token = authHeader.substring(7);
    const appId: string = request.params.id;

    // Try JWT first
    try {
      const secret = this.config.get<string>('JWT_SECRET') ?? 'change-me';
      const payload = this.jwtService.verify(token, { secret });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, status: true, orgId: true },
      });
      if (user && user.status !== 'suspended') {
        request.user = user;
        return true;
      }
    } catch {
      // Not a valid JWT — try deploy token
    }

    // Try deploy token
    const deployTokens = await this.prisma.deployToken.findMany({
      where: { appId },
    });

    for (const dt of deployTokens) {
      const match = await bcrypt.compare(token, dt.hashedToken);
      if (match) {
        // Update last used
        await this.prisma.deployToken.update({
          where: { id: dt.id },
          data: { lastUsedAt: new Date() },
        });
        // Set a synthetic user context for the deploy
        request.user = { id: null, role: 'deploy-token', orgId: null };
        request.deployTokenApp = appId;
        return true;
      }
    }

    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid token' });
  }
}
