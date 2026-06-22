/**
 * Shared command context: data-dir paths + a configured Docker instance +
 * the compose-file flags every lifecycle command needs.
 */
import { existsSync } from 'node:fs';
import { Docker, detectDocker } from './docker';
import { Paths, resolvePaths } from './paths';
import { readEnvFile } from './env';
import { die } from './ui';

export interface Ctx {
  paths: Paths;
  docker: Docker;
}

/**
 * Resolve the data dir and docker once. If requireDocker is true, exit with a
 * helpful message when the daemon is not reachable. If requireInstalled is
 * true, exit when the data dir has no materialized compose file yet.
 */
export function loadContext(
  opts: { requireDocker?: boolean; requireInstalled?: boolean } = {},
): Ctx {
  const paths = resolvePaths();

  if (opts.requireInstalled && !existsSync(paths.composeBase)) {
    die(
      `Zonal Cloud is not installed in ${paths.dataDir} ` +
        `(no docker-compose.yml). Run "zone install" first, ` +
        `or set ZONAL_DATA_DIR to the right location.`,
    );
  }

  const info = detectDocker();
  if (opts.requireDocker) {
    if (!info.installed) {
      die('Docker is not installed. Run "zone install" to set it up, or install Docker first.');
    }
    if (!info.reachable) {
      die(
        'Docker is installed but the daemon is not reachable. Start it with ' +
          '"sudo systemctl start docker", or add your user to the docker group ' +
          '("sudo usermod -aG docker $USER" then re-login).',
      );
    }
    if (!info.composeKind) {
      die('Docker Compose is not available (neither the "docker compose" plugin nor "docker-compose").');
    }
  }

  return { paths, docker: new Docker(info) };
}

/**
 * The -f flags for compose. Always includes the base file; includes the VPS
 * overlay (TLS / Let's Encrypt / :443) when present and the deployment is in
 * domain mode — detected by DOMAIN being set in .env. Reading .env here keeps
 * every lifecycle command consistent with how the stack was brought up.
 */
export function composeFiles(paths: Paths): string[] {
  const flags = ['-f', paths.composeBase];
  // The prod overlay defines the prebuilt-image app services (api/dashboard/
  // admin). Without it the base compose's commented-out stubs leave `api` with
  // no image/build context — so include it whenever it's present.
  if (existsSync(paths.composeProd)) {
    flags.push('-f', paths.composeProd);
  }
  if (existsSync(paths.composeVps) && isDomainMode(paths)) {
    flags.push('-f', paths.composeVps);
  }
  return flags;
}

/** True when .env has a non-empty DOMAIN (a real VPS deployment). */
export function isDomainMode(paths: Paths): boolean {
  const env = readEnvFile(paths.envFile);
  return !!(env.DOMAIN && env.DOMAIN.trim().length > 0);
}
