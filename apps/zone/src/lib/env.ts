/**
 * .env generation and reading for Zonal Cloud.
 *
 * The installer generates a production .env with strong random secrets for
 * POSTGRES_PASSWORD and JWT_SECRET. Existing values are preserved on re-runs
 * (the install is idempotent) unless the caller forces regeneration.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

export type EnvMap = Record<string, string>;

/** Parse a dotenv file into a flat map (no interpolation). */
export function parseEnv(content: string): EnvMap {
  const out: EnvMap = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function readEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, 'utf8'));
}

/** A URL-safe secret with no shell- or dotenv-hostile characters. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface GenerateEnvOptions {
  /** Public domain for the deployment; '' means localhost mode. */
  domain?: string;
  /** Force-regenerate secrets even if already present. */
  rotateSecrets?: boolean;
  /** Pre-existing values to preserve (e.g. from a prior .env). */
  existing?: EnvMap;
}

/**
 * Build the full env map for a production deployment. In a container-based
 * stack the API talks to postgres/redis by service name, so DATABASE_URL /
 * REDIS_URL use the in-network hostnames.
 */
export function buildEnv(opts: GenerateEnvOptions = {}): EnvMap {
  const e = opts.existing ?? {};
  const keep = (k: string, fallback: string): string =>
    e[k] && e[k].length > 0 ? e[k] : fallback;

  const pgUser = keep('POSTGRES_USER', 'zonal');
  const pgDb = keep('POSTGRES_DB', 'zonal');
  const pgPass =
    opts.rotateSecrets || !e.POSTGRES_PASSWORD
      ? generateSecret(24)
      : e.POSTGRES_PASSWORD;
  const jwt =
    opts.rotateSecrets || !e.JWT_SECRET ? generateSecret(48) : e.JWT_SECRET;

  const domain = opts.domain ?? e.DOMAIN ?? '';

  // Public hostnames for Traefik routing (used by docker-compose.prod.yml).
  const apiHost = domain ? `api.${domain}` : 'api.localhost';
  const dashHost = domain ? `dashboard.${domain}` : 'dashboard.localhost';
  const adminHost = domain ? `admin.${domain}` : 'admin.localhost';

  // Where the browser reaches the API. In the containerized stack the SPAs are
  // served through Traefik at api.<host>, so the build-time VITE_API_URL must
  // point there (not localhost:4000) for a real server deployment.
  const scheme = domain ? 'https' : 'http';
  const viteApiUrl = `${scheme}://${apiHost}`;
  // Public dashboard URL — linked from the admin account menu and used by the
  // impersonation flow. Derived from the domain like the other hosts.
  const dashboardUrl = `${scheme}://${dashHost}`;

  // CORS: dashboard + admin origins, matching the routed hostnames.
  const corsOrigins = `${scheme}://${dashHost},${scheme}://${adminHost}`;

  const env: EnvMap = {
    // Postgres
    POSTGRES_HOST: 'postgres',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: pgUser,
    POSTGRES_PASSWORD: pgPass,
    POSTGRES_DB: pgDb,
    DATABASE_URL: `postgresql://${pgUser}:${pgPass}@postgres:5432/${pgDb}`,
    // Redis
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    REDIS_URL: 'redis://redis:6379',
    // API — main.ts reads PORT.
    PORT: keep('PORT', '4000'),
    JWT_SECRET: jwt,
    // CORS_ORIGINS, the *_HOST names, and VITE_API_URL are DERIVED from the
    // domain — always recompute them so a domain switch (zone tls, or
    // re-running install --domain) actually takes effect. keep()ing them would
    // freeze stale localhost values and the SPAs would point at the wrong API.
    CORS_ORIGINS: corsOrigins,
    // Routing / frontend wiring (consumed by the bundled compose files).
    API_HOST: apiHost,
    DASHBOARD_HOST: dashHost,
    ADMIN_HOST: adminHost,
    VITE_API_URL: viteApiUrl,
    DASHBOARD_URL: dashboardUrl,
  };

  if (domain) env.DOMAIN = domain;

  // Preserve any extra keys the operator added (e.g. GITHUB_* OAuth).
  for (const [k, v] of Object.entries(e)) {
    if (!(k in env)) env[k] = v;
  }

  return env;
}

/** Serialize an env map to dotenv text with section comments. */
export function serializeEnv(env: EnvMap): string {
  const order: Array<[string, string[]]> = [
    ['Postgres', ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DATABASE_URL']],
    ['Redis', ['REDIS_HOST', 'REDIS_PORT', 'REDIS_URL']],
    ['API', ['PORT', 'JWT_SECRET', 'CORS_ORIGINS']],
    ['Routing / frontend', ['DOMAIN', 'API_HOST', 'DASHBOARD_HOST', 'ADMIN_HOST', 'VITE_API_URL', 'DASHBOARD_URL']],
    ['Registry / TLS', ['ZONAL_REGISTRY', 'ZONAL_TAG', 'ACME_EMAIL']],
  ];
  const written = new Set<string>();
  const lines: string[] = [
    '# Zonal Cloud environment — generated by zone.',
    '# Contains secrets. Keep this file private (chmod 600) and never commit it.',
    '',
  ];
  for (const [section, keys] of order) {
    const present = keys.filter((k) => k in env);
    if (present.length === 0) continue;
    lines.push(`# ${section}`);
    for (const k of present) {
      lines.push(`${k}=${env[k]}`);
      written.add(k);
    }
    lines.push('');
  }
  const extras = Object.keys(env).filter((k) => !written.has(k));
  if (extras.length) {
    lines.push('# Additional');
    for (const k of extras) lines.push(`${k}=${env[k]}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write the env file with 0600 permissions. */
export function writeEnvFile(path: string, env: EnvMap): void {
  writeFileSync(path, serializeEnv(env), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on filesystems without mode support */
  }
}
