import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/slug.util';

/**
 * First-install bootstrap: when the platform has no superadmin yet, create a
 * default one so the operator can sign in to the admin panel out of the box.
 *
 * Defaults (override via env): username "administrator", email
 * "admin@example.com", password "admin". The default password is intentionally
 * weak — the account is created with mustChangePassword=true, so the admin is
 * forced to set a strong (8+ char) password on first login.
 *
 * Recovery once the password is forgotten stays on the CLI:
 * `npm run create-superadmin -- <email> <password>` (see scripts/create-superadmin.ts).
 */
@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedDefaultAdmin();
    } catch (err) {
      // Never block API startup on seeding (e.g. migrations not yet applied).
      this.logger.error(
        `Default admin seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async seedDefaultAdmin() {
    const existing = await this.prisma.user.findFirst({
      where: { role: 'superadmin' },
      select: { id: true },
    });
    if (existing) {
      return; // Platform already initialised — nothing to do.
    }

    const email = (this.config.get<string>('DEFAULT_ADMIN_EMAIL') ?? 'admin@example.com')
      .trim()
      .toLowerCase();
    const username = (this.config.get<string>('DEFAULT_ADMIN_USERNAME') ?? 'administrator')
      .trim()
      .toLowerCase();
    const password = this.config.get<string>('DEFAULT_ADMIN_PASSWORD') ?? 'admin';
    const orgName = this.config.get<string>('DEFAULT_ADMIN_ORG') ?? 'Administrator';

    const passwordHash = await bcrypt.hash(password, 10);

    // Create the organization for the superadmin (unique slug) + default quota.
    // This also seeds the FIRST organization that regular users can register
    // into by slug.
    let orgSlug = slugify(orgName) || 'administrator';
    if (await this.prisma.organization.findUnique({ where: { slug: orgSlug } })) {
      orgSlug = `${orgSlug}-${Date.now()}`;
    }

    const organization = await this.prisma.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        plan: 'free',
        status: 'active',
        quota: {
          create: {
            maxApps: 100,
            cpu: '4',
            memory: '4g',
            disk: '50g',
            buildMinutes: 1000,
            maxConcurrentDeploys: 10,
          },
        },
      },
    });

    const user = await this.prisma.user.create({
      data: {
        organizationId: organization.id,
        username,
        email,
        passwordHash,
        role: 'superadmin',
        status: 'active',
        mustChangePassword: true,
      },
    });

    this.logger.warn(
      `No superadmin found — seeded default admin "${user.username}" (${user.email}). ` +
        `Sign in with the default password and you will be prompted to change it immediately.`,
    );
  }
}
