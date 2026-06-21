/**
 * Lifecycle commands: up, down, restart, status, logs, migrate, superadmin.
 * These all operate on an already-installed stack.
 */
import prompts from 'prompts';
import { Command } from 'commander';
import { loadContext } from '../lib/context';
import {
  createSuperadmin,
  down,
  logs,
  probeApi,
  psStatus,
  restart,
  runMigrations,
  up,
} from '../lib/stack';
import { ui, die } from '../lib/ui';

export function registerLifecycle(program: Command): void {
  program
    .command('up')
    .description('Start the Zonal Cloud stack')
    .option('--pull', 'pull the latest images before starting', false)
    .action(async (opts: { pull?: boolean }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const code = await up(ctx, opts.pull === true);
      process.exit(code);
    });

  program
    .command('down')
    .description('Stop and remove the Zonal Cloud containers')
    .option('--volumes', 'also remove named volumes (DESTROYS the database)', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(async (opts: { volumes?: boolean; yes?: boolean }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      if (opts.volumes && !opts.yes) {
        const ans = await prompts({
          type: 'confirm',
          name: 'go',
          message: 'This will DELETE the database and Redis volumes. Continue?',
          initial: false,
        });
        if (!ans.go) die('Aborted.');
      }
      const code = await down(ctx, opts.volumes === true);
      process.exit(code);
    });

  program
    .command('restart [service]')
    .description('Restart all services, or a single one (api, dashboard, admin, postgres, redis, traefik)')
    .action(async (service: string | undefined) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const code = await restart(ctx, service);
      process.exit(code);
    });

  program
    .command('logs [service]')
    .description('Show container logs (optionally for one service)')
    .option('-f, --follow', 'follow log output', false)
    .option('-n, --tail <lines>', 'number of lines to show from the end', '200')
    .action(async (service: string | undefined, opts: { follow?: boolean; tail: string }) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const code = await logs(ctx, service, opts.follow === true, opts.tail);
      process.exit(code);
    });

  program
    .command('status')
    .description('Show container status, migrations note, and API health')
    .action(async () => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });

      ui.heading('Services');
      const services = psStatus(ctx);
      if (services.length === 0) {
        ui.warn('No Zonal Cloud containers found. Run "zone install" or "zone up".');
      } else {
        for (const s of services) {
          const detail = s.health ? `${s.state} (${s.health})` : s.state;
          const running = /up|running/i.test(s.state);
          if (running && (!s.health || /healthy/i.test(s.health))) ui.ok(`${s.name}: ${detail}`);
          else if (running) ui.warn(`${s.name}: ${detail}`);
          else ui.fail(`${s.name}: ${detail}`);
        }
      }

      ui.heading('API');
      const probe = probeApi(ctx);
      if (probe.up) ui.ok(`responding (HTTP ${probe.status})`);
      else ui.fail('not responding (try "zone logs api")');
    });

  program
    .command('migrate')
    .description('Apply pending Prisma migrations (prisma migrate deploy)')
    .action(async () => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });
      const code = await runMigrations(ctx);
      if (code === 0) ui.ok('Migrations applied.');
      process.exit(code);
    });

  program
    .command('superadmin [email] [password] [orgName]')
    .description('Create or promote the platform superadmin')
    .action(async (email?: string, password?: string, orgName?: string) => {
      const ctx = loadContext({ requireDocker: true, requireInstalled: true });

      if (!email || !password) {
        const ans = await prompts([
          {
            type: email ? null : 'text',
            name: 'email',
            message: 'Superadmin email',
            validate: (v: string) => (/.+@.+\..+/.test(v) ? true : 'Enter a valid email'),
          },
          {
            type: password ? null : 'password',
            name: 'password',
            message: 'Superadmin password (min 8 chars)',
            validate: (v: string) => (v.length >= 8 ? true : 'At least 8 characters'),
          },
        ]);
        email = email ?? ans.email;
        password = password ?? ans.password;
      }
      if (!email || !password) die('Email and password are required.');
      if (password.length < 8) die('Password must be at least 8 characters.');

      const code = await createSuperadmin(ctx, email.toLowerCase(), password, orgName || 'Administrator');
      process.exit(code);
    });
}
