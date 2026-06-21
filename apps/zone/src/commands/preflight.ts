/**
 * `zone preflight` — read-only environment readiness report.
 *
 * Exits non-zero if any check is a hard failure, so it can gate CI / install.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { detectDocker } from '../lib/docker';
import { resolvePaths } from '../lib/paths';
import {
  CheckResult,
  checkDisk,
  checkDocker,
  checkMemory,
  checkOS,
  checkPorts,
} from '../lib/checks';
import { ui } from '../lib/ui';

function emit(r: CheckResult): void {
  const line = `${r.name}: ${r.detail}`;
  if (r.level === 'ok') ui.ok(line);
  else if (r.level === 'warn') ui.warn(line);
  else ui.fail(line);
}

export async function runPreflight(opts: { ports?: boolean } = {}): Promise<{
  failed: number;
  warned: number;
}> {
  const results: CheckResult[] = [];

  ui.heading('System');
  const paths = resolvePaths();
  // Check disk where the data dir lives (or its parent if not yet created).
  const diskTarget = existsSync(paths.dataDir) ? paths.dataDir : resolve(paths.dataDir, '..');
  ui.ok(`Data dir: ${paths.dataDir}${existsSync(paths.dataDir) ? '' : ' (will be created)'}`);
  [checkOS(), checkMemory(), checkDisk(diskTarget)].forEach((r) => {
    results.push(r);
    emit(r);
  });

  ui.heading('Docker');
  const dockerResults = checkDocker(detectDocker());
  dockerResults.forEach((r) => {
    results.push(r);
    emit(r);
  });

  if (opts.ports !== false) {
    ui.heading('Ports');
    const portResults = await checkPorts();
    portResults.forEach((r) => {
      results.push(r);
      emit(r);
    });
  }

  const failed = results.filter((r) => r.level === 'fail').length;
  const warned = results.filter((r) => r.level === 'warn').length;

  ui.heading('Summary');
  if (failed === 0 && warned === 0) ui.ok('All checks passed.');
  else ui.info(`${failed} failed, ${warned} warning(s).`);

  return { failed, warned };
}

export function registerPreflight(program: Command): void {
  program
    .command('preflight')
    .description('Check that this server is ready to run Zonal Cloud (read-only)')
    .option('--no-ports', 'skip TCP port availability checks')
    .action(async (opts: { ports?: boolean }) => {
      const { failed } = await runPreflight(opts);
      process.exit(failed > 0 ? 1 : 0);
    });
}
