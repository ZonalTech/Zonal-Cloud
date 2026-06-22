/**
 * Filesystem layout for a registry-based deployment.
 *
 * The CLI is installed standalone (npm i -g @zonal-cloud/zone) and does NOT need
 * the platform source on the server. Instead it owns a DATA DIRECTORY where it
 * writes the compose files (materialized from templates bundled in the
 * package), the rendered Traefik config, .env, and backups.
 *
 * Data dir resolution: ZONAL_DATA_DIR env, else /opt/zonal-cloud when writable
 * (or root), else ~/.zonal-cloud. The chosen dir is created on demand.
 *
 * The bundled templates live next to the compiled code, at <pkg>/templates.
 */
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Paths {
  /** Where state lives on the server. */
  dataDir: string;
  /** Bundled templates shipped in the package. */
  templatesDir: string;
  composeBase: string;
  composeVps: string;
  /** Rendered Traefik production config (written by tls.renderTraefikProd). */
  traefikProd: string;
  envFile: string;
  backupsDir: string;
}

const SYSTEM_DIR = '/opt/zonal-cloud';

function canWriteParent(dir: string): boolean {
  const parent = resolve(dir, '..');
  try {
    accessSync(parent, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Decide where the data dir should be (does not create it). */
export function resolveDataDir(): string {
  if (process.env.ZONAL_DATA_DIR) return resolve(process.env.ZONAL_DATA_DIR);
  // Prefer the system location when we can create/own it (root or writable /opt).
  if (process.getuid && process.getuid() === 0) return SYSTEM_DIR;
  if (existsSync(SYSTEM_DIR)) {
    try {
      accessSync(SYSTEM_DIR, constants.W_OK);
      return SYSTEM_DIR;
    } catch {
      /* fall through to home */
    }
  } else if (canWriteParent(SYSTEM_DIR)) {
    return SYSTEM_DIR;
  }
  return join(homedir(), '.zonal-cloud');
}

/** Locate the bundled templates dir (sibling of dist/, inside the package). */
export function templatesDir(): string {
  // Compiled file lives at <pkg>/dist/lib/paths.js → templates at <pkg>/templates.
  const candidates = [
    resolve(__dirname, '..', '..', 'templates'), // from dist/lib
    resolve(__dirname, '..', 'templates'), // from dist (if flattened)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: assume the first candidate; callers will error clearly if missing.
  return candidates[0];
}

export function resolvePaths(): Paths {
  const dataDir = resolveDataDir();
  return {
    dataDir,
    templatesDir: templatesDir(),
    composeBase: join(dataDir, 'docker-compose.yml'),
    composeVps: join(dataDir, 'docker-compose.vps.yml'),
    // Compose mounts ./services/proxy/traefik.prod.yml, so the rendered prod
    // config must live there (not flat in the data dir).
    traefikProd: join(dataDir, 'services', 'proxy', 'traefik.prod.yml'),
    envFile: join(dataDir, '.env'),
    backupsDir: join(dataDir, 'backups'),
  };
}

/** Create the data dir if needed; returns whether it already existed. */
export function ensureDataDir(paths: Paths): boolean {
  const existed = existsSync(paths.dataDir);
  if (!existed) mkdirSync(paths.dataDir, { recursive: true });
  return existed;
}
