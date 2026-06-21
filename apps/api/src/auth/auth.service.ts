import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserPurgeService } from '../common/user-purge.service';
import { MailService } from './mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { slugify } from '../common/slug.util';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeUser(user: {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  organizationId: string;
  mustChangePassword: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly userPurge: UserPurgeService,
  ) {}

  /**
   * Self-service account deletion. Requires the current password to confirm,
   * then permanently removes the account and everything it owns. The platform
   * superadmin is a CLI-managed account and cannot self-delete through the API.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
    }

    if (user.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin account is managed from the CLI and cannot be deleted here.',
      });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Password is incorrect' });
    }

    await this.userPurge.purge(userId);
    return { message: 'Your account and all associated data have been deleted.' };
  }

  /**
   * Begin password reset. Always returns a generic result (never reveals whether
   * the email exists). When the user exists, a one-time token (valid 1h) is
   * created; the link is emailed if SMTP is configured, otherwise the token is
   * returned in the response for local/dev use.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const generic = { message: 'If that account exists, a reset link has been sent.' };

    if (!user) {
      return generic;
    }

    // Invalidate any prior unused tokens for this user, then mint a fresh one.
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const base = this.config.get<string>('DASHBOARD_URL') ?? 'http://localhost:5173';
    const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;
    await this.mailService.sendPasswordReset(email, resetUrl);

    // In dev (no SMTP), hand the link back so the flow is usable without email.
    if (!this.mailService.enabled) {
      return { ...generic, devResetToken: token, devResetUrl: resetUrl };
    }
    return generic;
  }

  /** Complete password reset using a valid, unexpired, unused token. */
  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'This reset link is invalid or has expired. Request a new one.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Drop any other outstanding tokens for this user.
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      }),
    ]);

    return { message: 'Password updated. You can now sign in with your new password.' };
  }

  async register(dto: RegisterDto) {
    // Users join an EXISTING organization by slug — registration no longer
    // creates a personal org. The first organization is seeded out-of-band
    // (CLI seed / admin create-org); see scripts and the admin organizations API.
    const organization = await this.prisma.organization.findUnique({
      where: { slug: slugify(dto.organizationSlug) },
    });
    if (!organization) {
      throw new BadRequestException({
        code: 'ORG_NOT_FOUND',
        message: 'No organization with that slug. Check the slug or ask your admin to create it.',
      });
    }
    if (organization.status === 'suspended') {
      throw new ForbiddenException({
        code: 'ORG_SUSPENDED',
        message: 'This organization is suspended and cannot accept new members.',
      });
    }

    const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (emailTaken) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Email already in use' });
    }

    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameTaken) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Username already taken' });
    }

    // Web registration always creates a regular user. The platform superadmin is
    // created only from the CLI (see scripts/create-superadmin.ts) and its role
    // cannot be granted or changed through the UI/admin API.
    const role = 'user';
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        organizationId: organization.id,
        username: dto.username,
        email: dto.email,
        passwordHash,
        role,
        status: 'active',
      },
    });

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.organizationId,
    });

    return { token, user: safeUser(user) };
  }

  async login(dto: LoginDto) {
    // The identifier may be an email address or a username. Normalise and try
    // both so the default admin can sign in as "administrator" or by email.
    const identifier = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
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
      orgId: user.organizationId,
    });

    return { token, user: safeUser(user) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        organizationId: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
    return { user };
  }

  /**
   * Self-service password change for the signed-in user. Used both for the
   * forced first-login change (default admin) and any voluntary change. Requires
   * the current password, enforces the 8-char minimum on the new one, and clears
   * the mustChangePassword flag.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Account not found' });
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Current password is incorrect',
      });
    }

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException({
        code: 'SAME_PASSWORD',
        message: 'The new password must be different from the current one.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });

    // Mint a fresh token so the client keeps a valid session after the change.
    const token = this.jwtService.sign({
      sub: updated.id,
      email: updated.email,
      role: updated.role,
      orgId: updated.organizationId,
    });

    return { token, user: safeUser(updated) };
  }
}
