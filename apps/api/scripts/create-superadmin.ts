/**
 * CLI: create or promote the platform superadmin, writing directly to the database.
 *
 * The superadmin (the platform Administrator) can ONLY be created here, from the
 * terminal — never through the web UI. Once created, the superadmin role cannot
 * be changed or removed through the admin UI/API.
 *
 * Usage (run from apps/api):
 *   npm run create-superadmin -- <email> <password> [orgName] [username]
 *   npm run create-superadmin -- admin@example.com 'StrongPass#1' 'Administrator' admin
 *
 * Defaults: email=admin@example.com, orgName="Administrator",
 * username=<email local-part>.
 * If the user already exists it is promoted to superadmin (and the password is
 * updated when one is provided).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
}

async function main() {
  const email = (process.argv[2] || 'admin@example.com').trim().toLowerCase();
  const password = process.argv[3];
  const orgName = process.argv[4] || 'Administrator';
  const username = (process.argv[5] || email.split('@')[0] || 'admin')
    .trim()
    .toLowerCase();

  if (!password) {
    console.error(
      'Error: a password is required.\n' +
        "Usage: npm run create-superadmin -- <email> <password> [orgName]\n" +
        "Example: npm run create-superadmin -- admin@example.com 'StrongPass#1' 'Administrator'",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Error: password must be at least 8 characters.');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      const updated = await prisma.user.update({
        where: { email },
        data: { role: 'superadmin', status: 'active', passwordHash },
      });
      console.log(
        `Existing user promoted to superadmin: ${updated.email} (id ${updated.id}). Password updated.`,
      );
      return;
    }

    // Create the organization for the superadmin (unique slug) + default quota.
    // This also seeds the FIRST organization that regular users can register
    // into by slug.
    let orgSlug = slugify(orgName) || 'administrator';
    if (await prisma.organization.findUnique({ where: { slug: orgSlug } })) {
      orgSlug = `${orgSlug}-${Date.now()}`;
    }

    const organization = await prisma.organization.create({
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

    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        username,
        email,
        passwordHash,
        role: 'superadmin',
        status: 'active',
      },
    });

    console.log(
      `Superadmin created: ${user.email} (username ${user.username}, id ${user.id}), ` +
        `organization "${organization.name}" (slug "${organization.slug}").`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to create superadmin:', err instanceof Error ? err.message : err);
  process.exit(1);
});
