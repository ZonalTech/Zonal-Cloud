import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

function safeUser(user: {
  id: string;
  email: string;
  role: string;
  status: string;
  orgId: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    orgId: user.orgId,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Email already in use' });
    }

    let orgSlug = slugify(dto.orgName);

    // Ensure unique slug
    const slugExists = await this.prisma.org.findUnique({ where: { slug: orgSlug } });
    if (slugExists) {
      orgSlug = `${orgSlug}-${Date.now()}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const org = await this.prisma.org.create({
      data: {
        name: dto.orgName,
        slug: orgSlug,
        plan: 'free',
        status: 'active',
      },
    });

    // Create default quota
    await this.prisma.quota.create({
      data: {
        orgId: org.id,
        maxApps: 5,
        cpu: '1',
        memory: '512m',
        disk: '5g',
        buildMinutes: 60,
        maxConcurrentDeploys: 2,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        orgId: org.id,
        email: dto.email,
        passwordHash,
        role: 'superadmin',
        status: 'active',
      },
    });

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    });

    return { token, user: safeUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    }

    if (user.status === 'suspended') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account suspended' });
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    });

    return { token, user: safeUser(user) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        orgId: true,
        createdAt: true,
      },
    });
    return { user };
  }
}
