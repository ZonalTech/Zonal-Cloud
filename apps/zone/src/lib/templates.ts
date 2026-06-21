/**
 * Materialize bundled templates into the server data dir.
 *
 * On install the CLI copies its packaged compose + Traefik files into the data
 * dir so `docker compose` can run there. Existing files are overwritten so an
 * upgrade picks up new template versions — but .env and rendered secrets are
 * never templates and are left untouched.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Paths, ensureDataDir } from './paths';

const TEMPLATE_FILES = [
  'docker-compose.yml',
  'docker-compose.vps.yml',
  'traefik.yml',
  'traefik.prod.yml.template',
];

export interface MaterializeResult {
  dataDir: string;
  existed: boolean;
  copied: string[];
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
