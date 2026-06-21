/**
 * Higher-level operations on the running Zonal Cloud stack: migrations,
 * superadmin creation, health probing, and service status — all expressed in
 * terms of compose commands against the api container.
 *
 * Migrations and the superadmin script live inside the api image (it has
 * Prisma + scripts/create-superadmin.ts), so we run them with
 * `compose run --rm api ...` (one-shot) or `compose exec api ...` (live).
 */
import { Ctx, composeFiles } from './context';

const ENV = { COMPOSE_PROJECT_NAME: 'zonal' } as NodeJS.ProcessEnv;

/** compose argv prefixed with the right -f files + project name env. */
function composeArgs(ctx: Ctx, rest: string[]): string[] {
  return [...composeFiles(ctx.paths), ...rest];
}

/** Apply pending Prisma migrations inside a one-shot api container. */
export async function runMigrations(ctx: Ctx): Promise<number> {
  return ctx.docker.composeStream(
    composeArgs(ctx, [
      'run',
      '--rm',
      '--no-deps',
      'api',
      'npx',
      'prisma',
      'migrate',
      'deploy',
    ]),
    { cwd: ctx.paths.dataDir, env: ENV },
  );
}

/**
 * Create or promote the platform superadmin via the in-image script. Runs in a
 * one-shot api container so it works before the long-running api is up.
 */
export async function createSuperadmin(
  ctx: Ctx,
  email: string,
  password: string,
  orgName = 'Administrator',
): Promise<number> {
  return ctx.docker.composeStream(
    composeArgs(ctx, [
      'run',
      '--rm',
      '--no-deps',
      'api',
      'node',
      // Compiled by the API Dockerfile (scripts/ is excluded from nest build).
      'dist/scripts/create-superadmin.js',
      email,
      password,
      orgName,
    ]),
    { cwd: ctx.paths.dataDir, env: ENV },
  );
}

/** Pull the latest platform images from the registry. */
export async function pull(ctx: Ctx): Promise<number> {
  return ctx.docker.composeStream(composeArgs(ctx, ['pull']), {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
}

/**
 * Bring the whole stack up. In a registry deployment images are pulled, not
 * built — pass pullFirst to refresh them before starting.
 */
export async function up(ctx: Ctx, pullFirst = false): Promise<number> {
  if (pullFirst) {
    const code = await pull(ctx);
    if (code !== 0) return code;
  }
  return ctx.docker.composeStream(composeArgs(ctx, ['up', '-d']), {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
}

export async function down(ctx: Ctx, volumes = false): Promise<number> {
  const args = ['down'];
  if (volumes) args.push('--volumes');
  return ctx.docker.composeStream(composeArgs(ctx, args), {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
}

export async function restart(ctx: Ctx, service?: string): Promise<number> {
  const args = ['restart'];
  if (service) args.push(service);
  return ctx.docker.composeStream(composeArgs(ctx, args), {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
}

export async function logs(
  ctx: Ctx,
  service: string | undefined,
  follow: boolean,
  tail: string,
): Promise<number> {
  const args = ['logs', '--tail', tail];
  if (follow) args.push('-f');
  if (service) args.push(service);
  return ctx.docker.composeStream(composeArgs(ctx, args), {
    cwd: ctx.paths.dataDir,
    env: ENV,
  });
}

export interface ServiceStatus {
  name: string;
  state: string;
  health?: string;
}

/** Parse `compose ps` JSON into a normalized service list. */
export function psStatus(ctx: Ctx): ServiceStatus[] {
  const res = ctx.docker.compose(
    composeArgs(ctx, ['ps', '--all', '--format', 'json']),
    { cwd: ctx.paths.dataDir, env: ENV, allowFailure: true },
  );
  if (res.code !== 0 || !res.stdout.trim()) return [];
  // compose emits either a JSON array or newline-delimited JSON objects.
  const text = res.stdout.trim();
  const rows: any[] = [];
  if (text.startsWith('[')) {
    try {
      rows.push(...JSON.parse(text));
    } catch {
      /* ignore */
    }
  } else {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t));
      } catch {
        /* ignore */
      }
    }
  }
  return rows.map((r) => ({
    name: r.Service ?? r.Name ?? '?',
    state: r.State ?? r.Status ?? '?',
    health: r.Health || undefined,
  }));
}

/**
 * Probe the API from INSIDE its container (the api image ships curl). The API
 * has no dedicated /health route, but any HTTP response — even 404 — proves the
 * server is accepting connections. Returns up=false if the container isn't
 * running or curl can't connect yet.
 */
export function probeApi(ctx: Ctx): { up: boolean; status?: number } {
  const res = ctx.docker.compose(
    composeArgs(ctx, [
      'exec',
      '-T',
      'api',
      'curl',
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      'http://localhost:4000/v1',
    ]),
    { cwd: ctx.paths.dataDir, env: ENV, allowFailure: true },
  );
  const code = parseInt(res.stdout.trim(), 10);
  if (res.code === 0 && Number.isFinite(code) && code > 0) {
    return { up: true, status: code };
  }
  return { up: false };
}

/** Poll probeApi until it succeeds or the deadline passes. */
export async function waitForApi(ctx: Ctx, deadlineMs = 90_000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (probeApi(ctx).up) return true;
    if (Date.now() - start > deadlineMs) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
