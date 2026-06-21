/**
 * Maintenance commands: upgrade, backup, restore, secrets.
 */
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import prompts from 'prompts';
import { Command } from 'commander';
import { Ctx, composeFiles, loadContext } from '../lib/context';
import { runStream } from '../lib/exec';
import { buildEnv, readEnvFile, writeEnvFile } from '../lib/env';
import { down, runMigrations, up } from '../lib/stack';
import { materializeTemplates } from '../lib/templates';
import { renderTraefikProd, looksLikeEmail } from '../lib/tls';
import { ui, die } from '../lib/ui';

const ENV = { COMPOSE_PROJECT_NAME: 'zonal' } as NodeJS.ProcessEnv;

function composeArgs(ctx: Ctx, rest: string[]): string[] {
  return [...composeFiles(ctx.paths), ...rest];
}

/** Default timestamped backup path. A timestamp is passed in (no Date.now in libs). */
function defaultBackupPath(ctx: Ctx, stamp: string): string {
  const dir = ctx.paths.backupsDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `zonal-db-${stamp}.sql.gz`);
}

export function registerMaintenance(program: Command): void {
  // ---- upgrade ----
  program
    .command('upgrade')
    .description('Refresh deployment files, pull new images, migrate, and restart')
    .option('--tag <tag>', 'upgrade to a specific image tag (default: keep current)')
    .option('--no-backup', 'skip the pre-upgrade database backup')
    .action(async (opts: { tag?: string; backup?: boolean }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });

      if (opts.backup !== false) {
        ui.heading('Pre-upgrade backup');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const out = defaultBackupPath(ctx, stamp);
        const ok = await doBackup(ctx, out);
        if (!ok) {
          const ans = await prompts({
            type: 'confirm',
            name: 'go',
            message: 'Backup failed. Continue with the upgrade anyway?',
            initial: false,
          });
          if (!ans.go) die('Upgrade aborted.');
        }
      }

      // Refresh the bundled compose/Traefik files (the installed CLI may be
      // newer than what was last materialized), and bump the tag if requested.
      ui.heading('Refreshing deployment files');
      const mat = materializeTemplates(ctx.paths);
      ui.ok(`Updated: ${mat.copied.join(', ')}`);
      if (opts.tag) {
        const env = readEnvFile(ctx.paths.envFile);
        env.ZONAL_TAG = opts.tag;
        writeEnvFile(ctx.paths.envFile, env);
        ui.ok(`Image tag set to ${opts.tag}`);
      }

      ui.heading('Pulling images and restarting');
      const upCode = await up(ctx, true); // pull, then up
      if (upCode !== 0) die('Pull/up failed. See output above.');

      ui.heading('Migrations');
      const mig = await runMigrations(ctx);
      if (mig !== 0) die('Migrations failed after upgrade. The stack is up but the schema may be stale.');
      ui.ok('Upgrade complete.');
    });

  // ---- backup ----
  program
    .command('backup [outfile]')
    .description('Dump the Postgres database to a gzip file (default: ./backups/)')
    .action(async (outfile?: string) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = outfile
        ? isAbsolute(outfile)
          ? outfile
          : resolve(process.cwd(), outfile)
        : defaultBackupPath(ctx, stamp);
      const ok = await doBackup(ctx, target);
      process.exit(ok ? 0 : 1);
    });

  // ---- restore ----
  program
    .command('restore <infile>')
    .description('Restore the Postgres database from a backup file (gzip or plain SQL)')
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(async (infile: string, opts: { yes?: boolean }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const path = isAbsolute(infile) ? infile : resolve(process.cwd(), infile);
      if (!existsSync(path)) die(`Backup file not found: ${path}`);

      if (!opts.yes) {
        const ans = await prompts({
          type: 'confirm',
          name: 'go',
          message: 'Restoring will OVERWRITE the current database. Continue?',
          initial: false,
        });
        if (!ans.go) die('Aborted.');
      }
      const ok = await doRestore(ctx, path);
      process.exit(ok ? 0 : 1);
    });

  // ---- secrets rotate ----
  const secrets = program.command('secrets').description('Manage platform secrets');
  secrets
    .command('rotate')
    .description('Rotate JWT_SECRET (invalidates all sessions) and restart the API')
    .option('--db', 'also rotate the Postgres password (advanced; requires DB user update)', false)
    .option('-y, --yes', 'skip confirmation', false)
    .action(async (opts: { db?: boolean; yes?: boolean }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      if (!opts.yes) {
        const ans = await prompts({
          type: 'confirm',
          name: 'go',
          message: opts.db
            ? 'Rotate JWT and Postgres password? All users must log in again; the DB password will be changed in-place.'
            : 'Rotate JWT secret? All users will be logged out.',
          initial: false,
        });
        if (!ans.go) die('Aborted.');
      }

      const existing = readEnvFile(ctx.paths.envFile);
      if (Object.keys(existing).length === 0) die('No .env found. Run "zone install" first.');

      const oldPgPass = existing.POSTGRES_PASSWORD;
      // Build a fresh env with rotated secrets, preserving non-secret values.
      const rotated = buildEnv({ domain: existing.DOMAIN, existing, rotateSecrets: true });

      if (opts.db) {
        // We must authenticate the ALTER USER with the CURRENT password. If we
        // don't have it, we cannot change the DB password — and writing a new
        // POSTGRES_PASSWORD/DATABASE_URL to .env anyway would lock the API out
        // of the database. Refuse instead of silently breaking the deployment.
        if (!oldPgPass) {
          die('Cannot rotate the Postgres password: no current POSTGRES_PASSWORD in .env to authenticate the change. Rotate the JWT only (omit --db), or set the current password in .env first.');
        }
        ui.heading('Rotating Postgres password');
        const sql = `ALTER USER ${existing.POSTGRES_USER} WITH PASSWORD '${rotated.POSTGRES_PASSWORD.replace(/'/g, "''")}';`;
        const code = await ctx.docker.composeStream(
          composeArgs(ctx, [
            'exec',
            '-T',
            '-e',
            `PGPASSWORD=${oldPgPass}`,
            'postgres',
            'psql',
            '-v',
            'ON_ERROR_STOP=1',
            '-U',
            existing.POSTGRES_USER,
            '-d',
            existing.POSTGRES_DB,
            '-c',
            sql,
          ]),
          { cwd: ctx.paths.dataDir, env: ENV },
        );
        if (code !== 0) die('Failed to change the Postgres password in the database. .env was NOT modified.');
        ui.ok('Postgres password changed in the database.');
      } else {
        // JWT-only rotation: keep the existing DB password/URL untouched so the
        // API still authenticates against the unchanged database.
        rotated.POSTGRES_PASSWORD = oldPgPass;
        rotated.DATABASE_URL = existing.DATABASE_URL;
      }

      writeEnvFile(ctx.paths.envFile, rotated);
      ui.ok('.env updated with rotated secrets.');

      ui.heading('Restarting to apply');
      // A full down/up cycle is required so containers pick up new env values.
      await down(ctx, false);
      const code = await up(ctx, false);
      if (code !== 0) die('Restart failed after rotation. Check "zone status".');
      ui.ok('Secrets rotated and stack restarted.');
    });

  // ---- tls (enable / update HTTPS on an existing install) ----
  program
    .command('tls')
    .description('Enable or update HTTPS (Let\'s Encrypt) for a domain on an existing install')
    .option('--domain <domain>', 'public domain to switch to (e.g. example.com)')
    .option('--acme-email <email>', "email for Let's Encrypt registration/renewal")
    .action(async (opts: { domain?: string; acmeEmail?: string }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const existing = readEnvFile(ctx.paths.envFile);
      if (Object.keys(existing).length === 0) die('No .env found. Run "zone install" first.');

      const domain = opts.domain || existing.DOMAIN;
      if (!domain) die('No domain configured. Pass --domain to switch from localhost mode to TLS.');

      const acmeEmail = (opts.acmeEmail || existing.ACME_EMAIL || '').toLowerCase();
      if (!acmeEmail) die('No ACME email. Pass --acme-email.');
      if (!looksLikeEmail(acmeEmail)) die(`ACME email looks invalid: ${acmeEmail}`);

      // Rebuild env in domain mode (recomputes hosts/CORS/VITE_API_URL for the
      // domain), preserving secrets, and persist the ACME email.
      const env = buildEnv({ domain, existing });
      env.ACME_EMAIL = acmeEmail;
      writeEnvFile(ctx.paths.envFile, env);
      const path = renderTraefikProd(ctx.paths, acmeEmail);

      ui.ok(`Domain set to ${domain}; TLS config rendered: ${path}`);
      ui.info('DNS for these hosts must point at this server (ports 80+443 open):');
      ui.detail('record', env.API_HOST);
      ui.detail('record', env.DASHBOARD_HOST);
      ui.detail('record', env.ADMIN_HOST);

      ui.heading('Rebuilding and restarting with TLS');
      // The dashboard/admin bake VITE_API_URL at build time, so a rebuild is
      // needed when the API host changes (localhost -> domain).
      await down(ctx, false);
      const code = await up(ctx, true);
      if (code !== 0) die('Restart failed. Check "zone status" and "zone logs traefik".');
      ui.ok('HTTPS enabled. Certificates are issued on first request to each host.');
    });
}

/** pg_dump the database into a gzip file on the host. */
async function doBackup(ctx: Ctx, outfile: string): Promise<boolean> {
  const env = readEnvFile(ctx.paths.envFile);
  const user = env.POSTGRES_USER || 'zonal';
  const db = env.POSTGRES_DB || 'zonal';
  ui.step(`Dumping database "${db}" to ${outfile}`);

  // Stream pg_dump | gzip out of the container to a host file via redirection.
  // `set -o pipefail` makes the pipeline fail if pg_dump fails (not just gzip),
  // so a backup error is never reported as success. Requires bash.
  const composeFlags = composeFiles(ctx.paths)
    .map((f) => `'${f}'`)
    .join(' ');
  const composeBin = ctx.docker.composeKind === 'standalone' ? 'docker-compose' : 'docker compose';
  const inner =
    `set -o pipefail; ${composeBin} ${composeFlags} exec -T postgres ` +
    `pg_dump -U '${user}' -d '${db}' | gzip > '${outfile.replace(/'/g, `'\\''`)}'`;
  const cmd = ctx.docker.needsSg ? ['sg', ['docker', '-c', inner]] : ['bash', ['-c', inner]];

  const code = await runStream(cmd[0] as string, cmd[1] as string[], {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
  if (code === 0) {
    ui.ok(`Backup written: ${outfile}`);
    return true;
  }
  // A partial/empty file would be misleading — remove it so a failed backup
  // can't be mistaken for a good one later.
  try {
    if (existsSync(outfile)) unlinkSync(outfile);
  } catch {
    /* best effort */
  }
  ui.fail('Backup failed (incomplete file removed).');
  return false;
}

/** Restore from a gzip or plain-SQL dump. */
async function doRestore(ctx: Ctx, infile: string): Promise<boolean> {
  const env = readEnvFile(ctx.paths.envFile);
  const user = env.POSTGRES_USER || 'zonal';
  const db = env.POSTGRES_DB || 'zonal';
  ui.step(`Restoring database "${db}" from ${infile}`);

  const composeFlags = composeFiles(ctx.paths)
    .map((f) => `'${f}'`)
    .join(' ');
  const composeBin = ctx.docker.composeKind === 'standalone' ? 'docker-compose' : 'docker compose';
  const decompress = infile.endsWith('.gz') ? 'gunzip -c' : 'cat';
  // pipefail: a truncated/corrupt archive (gunzip failure) fails the whole
  // pipeline instead of psql swallowing partial input and exiting 0.
  // ON_ERROR_STOP=1: psql aborts (non-zero) on the first SQL error rather than
  // plowing through and reporting success on a half-applied restore. Requires bash.
  const inner =
    `set -o pipefail; ${decompress} '${infile.replace(/'/g, `'\\''`)}' | ` +
    `${composeBin} ${composeFlags} exec -T postgres psql -v ON_ERROR_STOP=1 -U '${user}' -d '${db}'`;
  const cmd = ctx.docker.needsSg ? ['sg', ['docker', '-c', inner]] : ['bash', ['-c', inner]];

  const code = await runStream(cmd[0] as string, cmd[1] as string[], {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
  if (code === 0) {
    ui.ok('Restore complete.');
    return true;
  }
  ui.fail('Restore failed — the database may be partially restored; check "zone logs postgres".');
  return false;
}
