/**
 * System preflight checks for a Zonal Cloud server install.
 *
 * Each check returns a status so the install flow can decide whether to
 * proceed. Checks are intentionally read-only and side-effect free.
 */
import { createServer } from 'node:net';
import { statfsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { run } from './exec';
import { DockerInfo } from './docker';

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  level: CheckLevel;
  detail: string;
}

/** Ports the platform needs free (or owned by our own containers). */
export const REQUIRED_PORTS = [
  { port: 80, what: 'Traefik HTTP entrypoint' },
  { port: 443, what: 'Traefik HTTPS entrypoint (domain mode)' },
  { port: 4000, what: 'API' },
  { port: 5432, what: 'Postgres' },
  { port: 6379, what: 'Redis' },
];

/** Check if a TCP port can be bound on 0.0.0.0 right now. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

export function checkOS(): CheckResult {
  if (process.platform !== 'linux') {
    return {
      name: 'Operating system',
      level: 'warn',
      detail: `${process.platform} — Zonal Cloud is designed for Linux servers; Docker behavior may differ.`,
    };
  }
  let pretty = 'Linux';
  const res = run('sh', ['-c', '. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"'], {
    allowFailure: true,
  });
  if (res.code === 0 && res.stdout.trim()) pretty = res.stdout.trim();
  return { name: 'Operating system', level: 'ok', detail: pretty };
}

export function checkMemory(minGb = 2): CheckResult {
  const gb = totalmem() / 1024 ** 3;
  const detail = `${gb.toFixed(1)} GiB total RAM`;
  if (gb < minGb) {
    return {
      name: 'Memory',
      level: 'warn',
      detail: `${detail} (recommended >= ${minGb} GiB; builds may fail under memory pressure)`,
    };
  }
  return { name: 'Memory', level: 'ok', detail };
}

export function checkDisk(path: string, minGb = 10): CheckResult {
  try {
    const s = statfsSync(path);
    const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
    const detail = `${freeGb.toFixed(1)} GiB free at ${path}`;
    if (freeGb < minGb) {
      return {
        name: 'Disk space',
        level: 'warn',
        detail: `${detail} (recommended >= ${minGb} GiB for images + volumes)`,
      };
    }
    return { name: 'Disk space', level: 'ok', detail };
  } catch (err) {
    return {
      name: 'Disk space',
      level: 'warn',
      detail: `could not determine free space: ${err instanceof Error ? err.message : err}`,
    };
  }
}

export function checkDocker(info: DockerInfo): CheckResult[] {
  const out: CheckResult[] = [];
  if (!info.installed) {
    out.push({
      name: 'Docker',
      level: 'fail',
      detail: 'not installed (zone install can set it up via get.docker.com)',
    });
    return out;
  }
  if (!info.reachable) {
    out.push({
      name: 'Docker daemon',
      level: 'fail',
      detail: 'installed but not reachable (daemon stopped, or user lacks docker-group access)',
    });
    return out;
  }
  out.push({
    name: 'Docker',
    level: 'ok',
    detail: `engine ${info.version}${info.needsSg ? ' (via sg docker)' : ''}`,
  });
  if (!info.composeKind) {
    out.push({ name: 'Docker Compose', level: 'fail', detail: 'not available' });
  } else {
    out.push({
      name: 'Docker Compose',
      level: 'ok',
      detail: `${info.composeVersion ?? '?'} (${info.composeKind})`,
    });
  }
  return out;
}

export async function checkPorts(ports = REQUIRED_PORTS): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { port, what } of ports) {
    const free = await portFree(port);
    results.push({
      name: `Port ${port}`,
      level: free ? 'ok' : 'warn',
      detail: free
        ? `free (${what})`
        : `in use — ${what}. If it is held by an existing Zonal Cloud container this is fine; otherwise free it.`,
    });
  }
  return results;
}
