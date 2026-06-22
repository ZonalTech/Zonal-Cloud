#!/usr/bin/env node
/**
 * zone — operator CLI for installing and maintaining Zonal Cloud on a
 * Linux server.
 *
 *   zone preflight      check server readiness
 *   zone install        bootstrap the full stack
 *   zone up|down|restart|status|logs
 *   zone migrate        apply DB migrations
 *   zone superadmin     create/promote the platform admin
 *   zone upgrade        pull, rebuild, migrate, restart
 *   zone backup|restore database snapshots
 *   zone secrets rotate rotate JWT / DB secrets
 */
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setDryRun } from './lib/exec';

// Read the real version from package.json (dist/index.js → ../package.json) so
// it never drifts from what's published/installed.
function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
import { ui } from './lib/ui';
import { registerPreflight } from './commands/preflight';
import { registerInstall } from './commands/install';
import { registerLifecycle } from './commands/lifecycle';
import { registerMaintenance } from './commands/maintenance';

const program = new Command();

program
  .name('zone')
  .description('Operator CLI to install, run, and maintain Zonal Cloud on Linux servers')
  .version(pkgVersion())
  .option('--dry-run', 'print commands instead of executing them', false)
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().dryRun) {
      setDryRun(true);
      ui.warn('dry-run: no changes will be made.');
    }
  });

registerPreflight(program);
registerInstall(program);
registerLifecycle(program);
registerMaintenance(program);

program.parseAsync(process.argv).catch((err) => {
  ui.fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
