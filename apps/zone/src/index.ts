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
import { setDryRun } from './lib/exec';
import { ui } from './lib/ui';
import { registerPreflight } from './commands/preflight';
import { registerInstall } from './commands/install';
import { registerLifecycle } from './commands/lifecycle';
import { registerMaintenance } from './commands/maintenance';

const program = new Command();

program
  .name('zone')
  .description('Operator CLI to install, run, and maintain Zonal Cloud on Linux servers')
  .version('0.1.0')
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
