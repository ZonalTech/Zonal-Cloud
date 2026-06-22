/**
 * Sync the repo's compose files + service-config tree into the CLI's bundled
 * `templates/` dir, so a published @zonalcloud/zone package carries everything
 * `docker compose` mounts (pdns.conf, traefik configs, fallback assets, the
 * PowerDNS schema, the mail server config). Run automatically on build.
 *
 * Source of truth = the repo root; templates/ is a build artifact.
 */
const { cpSync, copyFileSync, mkdirSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

// apps/zone/scripts -> repo root is three levels up.
const repoRoot = resolve(__dirname, '..', '..', '..');
const templatesDir = resolve(__dirname, '..', 'templates');

const FILES = [
  'docker-compose.yml',
  'docker-compose.vps.yml',
];

const DIRS = ['services'];

mkdirSync(templatesDir, { recursive: true });

for (const f of FILES) {
  const src = join(repoRoot, f);
  if (!existsSync(src)) throw new Error(`sync-templates: missing ${src}`);
  copyFileSync(src, join(templatesDir, f));
}

for (const d of DIRS) {
  const src = join(repoRoot, d);
  if (!existsSync(src)) throw new Error(`sync-templates: missing ${src}`);
  cpSync(src, join(templatesDir, d), { recursive: true });
}

// The flat traefik.yml / traefik.prod.yml.template live under services/proxy in
// the repo; the CLI's readTemplate() looks for them at the templates root, so
// mirror them there too (keeps both the directory mount and the renderer happy).
const proxy = join(repoRoot, 'services', 'proxy');
for (const f of ['traefik.yml', 'traefik.prod.yml.template']) {
  const src = join(proxy, f);
  if (existsSync(src)) copyFileSync(src, join(templatesDir, f));
}

console.log('sync-templates: copied compose files + services/ tree into templates/');
