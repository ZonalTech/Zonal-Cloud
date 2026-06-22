/**
 * `zone install` — bootstrap Zonal Cloud on this server.
 *
 * Registry deployment: the platform runs as PREBUILT images pulled from a
 * registry — no source checkout on the server. The CLI materializes the
 * compose files (bundled in the package) into a data dir, generates .env, then
 * pulls + starts.
 *
 * Orchestrates the full bring-up, idempotently:
 *   1. preflight (abort on hard failures unless --force)
 *   2. ensure Docker is installed + reachable (offer get.docker.com)
 *   3. materialize compose templates into the data dir
 *   4. generate .env with strong secrets (preserve existing on re-run)
 *   5. pull images + bring the stack up
 *   6. apply Prisma migrations
 *   7. create the first superadmin (prompted, unless already present / flags)
 *   8. wait for the API to answer, print access URLs
 *
 * Designed to be safe to re-run: existing secrets are kept, and migrate/up are
 * idempotent. Use --non-interactive for unattended/CI installs.
 */
import prompts from 'prompts';
import { Command } from 'commander';
import { Ctx, loadContext } from '../lib/context';
import { detectDocker } from '../lib/docker';
import { runStream } from '../lib/exec';
import { buildEnv, readEnvFile, writeEnvFile, EnvMap } from '../lib/env';
import {
  createSuperadmin,
  pull,
  restart,
  runMigrations,
  up,
  waitForApi,
} from '../lib/stack';
import { bootstrapDns, freePort53 } from '../lib/dnsbootstrap';
import { materializeTemplates } from '../lib/templates';
import { renderTraefikProd, looksLikeEmail } from '../lib/tls';
import { runPreflight } from './preflight';
import { ui, die } from '../lib/ui';

const DEFAULT_REGISTRY = 'ghcr.io/zonaltech/zonal-cloud';

interface InstallOpts {
  domain?: string;
  acmeEmail?: string;
  registry?: string;
  tag?: string;
  adminEmail?: string;
  adminPassword?: string;
  nonInteractive?: boolean;
  force?: boolean;
  installDocker?: boolean;
}

/** Install Docker via the official convenience script (requires root/sudo). */
async function ensureDocker(opts: InstallOpts): Promise<void> {
  let info = detectDocker();
  if (info.reachable && info.composeKind) {
    ui.ok(`Docker ${info.version} with compose (${info.composeKind}) present.`);
    return;
  }

  if (!info.installed) {
    if (opts.nonInteractive && !opts.installDocker) {
      die('Docker is not installed. Re-run with --install-docker to install it automatically, or install Docker first.');
    }
    let proceed = opts.installDocker === true;
    if (!proceed && !opts.nonInteractive) {
      const ans = await prompts({
        type: 'confirm',
        name: 'go',
        message: 'Docker is not installed. Install it now via https://get.docker.com (needs sudo)?',
        initial: true,
      });
      proceed = ans.go === true;
    }
    if (!proceed) die('Docker is required. Aborting.');

    ui.step('Installing Docker via get.docker.com (this can take a few minutes)...');
    const code = await runStream('sh', [
      '-c',
      'curl -fsSL https://get.docker.com | sudo sh',
    ]);
    if (code !== 0) die('Docker installation failed. Install Docker manually and re-run.');
    ui.ok('Docker installed.');
    ui.info('If you want to run docker without sudo, add your user to the docker group:');
    ui.info('  sudo usermod -aG docker "$USER"   (then log out and back in)');
  }

  info = detectDocker();
  if (!info.reachable) {
    die(
      'Docker is installed but the daemon is not reachable for this user. ' +
        'Start it (sudo systemctl start docker) and/or add your user to the docker group, then re-run.',
    );
  }
  if (!info.composeKind) {
    die('Docker Compose plugin is missing. Install the docker-compose-plugin package and re-run.');
  }
}

/**
 * Resolve/generate the .env, preserving any existing secrets. In domain mode
 * this also persists ACME_EMAIL and renders the Traefik production (TLS)
 * config so Let's Encrypt can issue certificates.
 */
function ensureEnv(ctx: Ctx, opts: InstallOpts, acmeEmail?: string): EnvMap {
  const existing = readEnvFile(ctx.paths.envFile);
  const hadEnv = Object.keys(existing).length > 0;
  const env = buildEnv({
    domain: opts.domain,
    existing,
    mailAdminEmail: acmeEmail || opts.adminEmail,
  });

  // Registry image source (used by the bundled compose's image: tags).
  env.ZONAL_REGISTRY = opts.registry || existing.ZONAL_REGISTRY || DEFAULT_REGISTRY;
  env.ZONAL_TAG = opts.tag || existing.ZONAL_TAG || 'latest';

  // Host data dir — the API mounts this into the one-shot helper that runs
  // `zone upgrade` triggered from the admin UI.
  env.ZONAL_DATA_DIR = ctx.paths.dataDir;

  const domainMode = !!env.DOMAIN;
  if (domainMode) {
    const email = acmeEmail || existing.ACME_EMAIL;
    if (!email) die('A domain was given but no ACME email is available. Pass --acme-email or set a superadmin email.');
    if (!looksLikeEmail(email)) die(`ACME email looks invalid: ${email}`);
    env.ACME_EMAIL = email;
  }

  writeEnvFile(ctx.paths.envFile, env);

  if (hadEnv) ui.ok(`.env updated (existing secrets preserved): ${ctx.paths.envFile}`);
  else ui.ok(`.env generated with fresh secrets (0600): ${ctx.paths.envFile}`);
  ui.detail('DOMAIN', env.DOMAIN || '(localhost mode)');
  ui.detail('Images', `${env.ZONAL_REGISTRY}/{api,dashboard,admin}:${env.ZONAL_TAG}`);
  ui.detail('API host', env.API_HOST);
  ui.detail('Dashboard host', env.DASHBOARD_HOST);
  ui.detail('Admin host', env.ADMIN_HOST);

  if (domainMode) {
    const path = renderTraefikProd(ctx.paths, env.ACME_EMAIL);
    ui.ok(`TLS enabled — rendered Traefik production config: ${path}`);
    ui.detail('ACME email', env.ACME_EMAIL);
  }
  return env;
}

/** Prompt for / validate superadmin credentials. */
async function resolveAdminCreds(
  opts: InstallOpts,
): Promise<{ email: string; password: string } | null> {
  if (opts.adminEmail && opts.adminPassword) {
    if (opts.adminPassword.length < 8) die('Superadmin password must be at least 8 characters.');
    return { email: opts.adminEmail.toLowerCase(), password: opts.adminPassword };
  }
  if (opts.nonInteractive) {
    ui.skip('No --admin-email/--admin-password given in non-interactive mode; skipping superadmin creation.');
    ui.info('Create one later with: zone superadmin <email> <password>');
    return null;
  }

  const ans = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Superadmin email',
      validate: (v: string) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Superadmin password (min 8 chars)',
      validate: (v: string) => (v.length >= 8 ? true : 'At least 8 characters'),
    },
    {
      type: 'password',
      name: 'confirm',
      message: 'Confirm password',
    },
  ]);

  if (!ans.email || !ans.password) {
    ui.skip('Superadmin creation skipped.');
    return null;
  }
  if (ans.password !== ans.confirm) die('Passwords did not match.');
  return { email: String(ans.email).toLowerCase(), password: ans.password };
}

/**
 * Resolve the email Let's Encrypt should register. Preference order:
 *   --acme-email → --admin-email → existing ACME_EMAIL in .env → prompt.
 */
async function resolveAcmeEmail(ctx: Ctx, opts: InstallOpts): Promise<string> {
  const fromFlag = opts.acmeEmail || opts.adminEmail;
  if (fromFlag) return fromFlag.toLowerCase();

  const existing = readEnvFile(ctx.paths.envFile).ACME_EMAIL;
  if (existing) return existing;

  if (opts.nonInteractive) {
    die('Domain mode needs an ACME email. Pass --acme-email or --admin-email in non-interactive mode.');
  }
  const ans = await prompts({
    type: 'text',
    name: 'email',
    message: "Email for Let's Encrypt (renewal + expiry notices)",
    validate: (v: string) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
  });
  if (!ans.email) die('An ACME email is required for TLS.');
  return String(ans.email).toLowerCase();
}

export function registerInstall(program: Command): void {
  program
    .command('install')
    .description('Install and bring up the full Zonal Cloud stack on this server')
    .option('--domain <domain>', 'public domain (e.g. example.com); omit for localhost mode')
    .option('--acme-email <email>', "email for Let's Encrypt (defaults to the superadmin email)")
    .option('--registry <url>', `image registry (default: ${DEFAULT_REGISTRY})`)
    .option('--tag <tag>', 'image tag to deploy (default: latest)')
    .option('--admin-email <email>', 'superadmin email (non-interactive)')
    .option('--admin-password <password>', 'superadmin password (non-interactive)')
    .option('--non-interactive', 'never prompt; use flags/defaults only', false)
    .option('--force', 'continue even if preflight reports failures', false)
    .option('--install-docker', 'install Docker automatically if missing', false)
    .action(async (opts: InstallOpts) => {
      ui.heading('Zonal Cloud install');

      // 1. preflight. Port checks are included but only ever WARN (never fail),
      // since on a re-install our own running containers legitimately hold
      // 80/443/4000/5432/6379 — those warnings are expected, not blocking.
      const { failed } = await runPreflight({ ports: true });
      if (failed > 0 && !opts.force) {
        die(`Preflight reported ${failed} failure(s). Fix them, or re-run with --force to proceed anyway.`);
      }

      // 2. Docker
      ui.heading('Docker');
      await ensureDocker(opts);

      // Now that docker is guaranteed, load the context.
      const ctx = loadContext({ requireDocker: true });

      // 3. materialize the bundled compose + Traefik files into the data dir.
      ui.heading('Deployment files');
      const mat = materializeTemplates(ctx.paths);
      ui.ok(`${mat.existed ? 'Refreshed' : 'Created'} data dir: ${mat.dataDir}`);
      ui.detail('files', mat.copied.join(', '));

      // 4. env (+ TLS in domain mode)
      ui.heading('Configuration');
      const acmeEmail = opts.domain ? await resolveAcmeEmail(ctx, opts) : undefined;
      const env = ensureEnv(ctx, opts, acmeEmail);

      if (env.DOMAIN) {
        ui.newline();
        ui.info('Before Let\'s Encrypt can issue certificates, these DNS A/AAAA records');
        ui.info('must point at THIS server\'s public IP and ports 80 + 443 must be reachable:');
        ui.detail('record', env.API_HOST);
        ui.detail('record', env.DASHBOARD_HOST);
        ui.detail('record', env.ADMIN_HOST);
        ui.info('A wildcard *.' + env.DOMAIN + ' record covers all three.');
      }

      // 5. Managed DNS prep — free host port 53 so pdns can bind it. Safe/no-op
      // when systemd-resolved isn't holding it.
      ui.heading('Managed DNS');
      freePort53();

      // 6. pull + up
      ui.heading('Pulling images and starting the stack');
      const pullCode = await pull(ctx);
      if (pullCode !== 0) {
        die('docker compose pull failed. Check the registry/tag and that images are published (or that you are logged in for a private registry).');
      }
      const upCode = await up(ctx, false);
      if (upCode !== 0) die('docker compose up failed. See output above.');
      ui.ok('Containers are up.');

      // 7. migrations
      ui.heading('Database migrations');
      const migCode = await runMigrations(ctx);
      if (migCode !== 0) die('Prisma migrate deploy failed. See output above.');
      ui.ok('Migrations applied.');

      // 8. DNS backend bootstrap (pdns db + schema), then (re)start pdns so it
      // connects cleanly. Postgres is up by now; this is idempotent.
      bootstrapDns(ctx);
      await restart(ctx, 'pdns');

      // 6. superadmin
      ui.heading('Superadmin');
      const creds = await resolveAdminCreds(opts);
      if (creds) {
        const code = await createSuperadmin(ctx, creds.email, creds.password);
        if (code !== 0) ui.warn('Superadmin creation reported an error (see above). You can retry with "zone superadmin".');
        else ui.ok(`Superadmin ready: ${creds.email}`);
      }

      // 7. health
      ui.heading('Health');
      ui.step('Waiting for the API container to respond...');
      const apiUp = await waitForApi(ctx, 90_000);
      if (apiUp) ui.ok('API is responding.');
      else ui.warn('API did not respond within 90s. Check "zone logs api".');

      // Done — print access info.
      const scheme = env.DOMAIN ? 'https' : 'http';
      ui.heading('Zonal Cloud is installed');
      ui.detail('Dashboard', `${scheme}://${env.DASHBOARD_HOST}`);
      ui.detail('Admin', `${scheme}://${env.ADMIN_HOST}`);
      ui.detail('API', `${scheme}://${env.API_HOST}/v1`);
      ui.detail('Mail (Stalwart)', env.MAIL_URL);
      ui.detail('Mail admin login', env.MAIL_ADMIN_USER);
      ui.detail('Mail admin password', env.MAIL_ADMIN_PASSWORD);
      ui.newline();
      ui.info(`Managed DNS nameservers: ${env.DNS_NAMESERVERS}`);
      ui.info('Customers delegate their domains to these; grant a DNS quota in Admin → Organizations.');
      if (env.DOMAIN) {
        ui.newline();
        ui.info('TLS: Let\'s Encrypt issues certificates on first request to each host.');
        ui.info('The first HTTPS hit may take a few seconds while the cert is obtained.');
        ui.info('If certs do not appear, check DNS, that ports 80+443 are open, then "zone logs traefik".');
      } else {
        ui.newline();
        ui.info('Localhost mode: *.localhost resolves automatically on most systems.');
        ui.info('On a remote server, map these hostnames to the server IP in your DNS or /etc/hosts.');
      }
      ui.newline();
      ui.info('Manage the stack with: zone status | logs | restart | down | upgrade');
    });
}
