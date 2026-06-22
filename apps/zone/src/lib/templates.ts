/**
 * Materialize bundled templates into the server data dir.
 *
 * On install the CLI copies its packaged compose + Traefik files into the data
 * dir so `docker compose` can run there. Existing files are overwritten so an
 * upgrade picks up new template versions — but .env and rendered secrets are
 * never templates and are left untouched.
 *
 * The compose files mount service config from a `services/` subtree relative to
 * the data dir (e.g. `./services/dns/pdns.conf`, `./services/proxy/...`), so the
 * whole `services/` tree is shipped in the package and copied recursively too.
 * Without this, `docker compose up` for pdns / traefik / fallback would mount
 * non-existent paths and fail.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { Paths, ensureDataDir } from './paths';

const TEMPLATE_FILES = [
  'docker-compose.yml',
  'docker-compose.vps.yml',
  'traefik.yml',
  'traefik.prod.yml.template',
];

// Directory subtrees copied verbatim into the data dir (preserving structure).
const TEMPLATE_DIRS = ['services'];

export interface MaterializeResult {
  dataDir: string;
  existed: boolean;
  copied: string[];
}

/** Recursively copy a directory tree, overwriting existing files. */
function copyTree(srcDir: string, destDir: string, copied: string[], rel = ''): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const dest = join(destDir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    if (statSync(src).isDirectory()) {
      copyTree(src, dest, copied, relPath);
    } else {
      copyFileSync(src, dest);
      copied.push(relPath);
    }
  }
}

/** Copy all bundled templates into the data dir. */
export function materializeTemplates(paths: Paths): MaterializeResult {
  const existed = ensureDataDir(paths);
  const copied: string[] = [];
  for (const name of TEMPLATE_FILES) {
    const src = join(paths.templatesDir, name);
    if (!existsSync(src)) {
      throw new Error(
        `Bundled template missing: ${src}. The CLI package may be corrupt; reinstall @zonal-cloud/zone.`,
      );
    }
    copyFileSync(src, join(paths.dataDir, name));
    copied.push(name);
  }
  for (const dir of TEMPLATE_DIRS) {
    const src = join(paths.templatesDir, dir);
    if (!existsSync(src)) {
      throw new Error(
        `Bundled template dir missing: ${src}. The CLI package may be corrupt; reinstall @zonal-cloud/zone.`,
      );
    }
    copyTree(src, join(paths.dataDir, dir), copied, dir);
  }
  return { dataDir: paths.dataDir, existed, copied };
}

/** Read a bundled template's contents (e.g. the Traefik prod template). */
export function readTemplate(paths: Paths, name: string): string {
  const src = join(paths.templatesDir, name);
  if (!existsSync(src)) {
    throw new Error(`Bundled template missing: ${src}.`);
  }
  return readFileSync(src, 'utf8');
}
