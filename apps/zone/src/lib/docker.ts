/**
 * Docker and Docker Compose abstraction.
 *
 * Handles two real-world wrinkles observed on Zonal Cloud servers:
 *   1. `docker compose` (v2 plugin) vs legacy `docker-compose` (v1 binary).
 *   2. The invoking user may not be in the `docker` group, so direct `docker`
 *      calls fail with a socket-permission error. When that happens and the
 *      user can `sg docker`, we transparently wrap commands in
 *      `sg docker -c "..."`.
 *
 * detectDocker() resolves the right invocation once; callers use the returned
 * Docker instance for everything else.
 */
import { run, runStream, commandExists, RunResult, RunOptions } from './exec';

export interface DockerInfo {
  /** Docker CLI is installed. */
  installed: boolean;
  /** The docker daemon is reachable (possibly via sg docker). */
  reachable: boolean;
  /** Whether commands must be wrapped in `sg docker -c`. */
  needsSg: boolean;
  /** "compose" (v2 plugin) | "docker-compose" (v1) | null. */
  composeKind: 'plugin' | 'standalone' | null;
  /** Docker engine version string, if reachable. */
  version?: string;
  /** Docker compose version string, if available. */
  composeVersion?: string;
}

/**
 * Quote and join argv into a single shell string for `sg docker -c`.
 */
function shellJoin(args: string[]): string {
  return args
    .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
    .join(' ');
}

export class Docker {
  constructor(private readonly info: DockerInfo) {}

  get needsSg(): boolean {
    return this.info.needsSg;
  }

  get composeKind(): 'plugin' | 'standalone' | null {
    return this.info.composeKind;
  }

  /** Build the argv for a compose command, applying compose-kind + sg wrapper. */
  private composeArgv(args: string[]): { cmd: string; argv: string[] } {
    const base =
      this.info.composeKind === 'standalone'
        ? { bin: 'docker-compose', prefix: [] as string[] }
        : { bin: 'docker', prefix: ['compose'] };
    const full = [...base.prefix, ...args];
    if (this.info.needsSg) {
      return {
        cmd: 'sg',
        argv: ['docker', '-c', `${base.bin} ${shellJoin(full)}`],
      };
    }
    return { cmd: base.bin, argv: full };
  }

  compose(args: string[], opts: RunOptions = {}): RunResult {
    const { cmd, argv } = this.composeArgv(args);
    return run(cmd, argv, opts);
  }

  composeStream(args: string[], opts: RunOptions = {}): Promise<number> {
    const { cmd, argv } = this.composeArgv(args);
    return runStream(cmd, argv, opts);
  }
}

/**
 * Probe the environment and decide how to invoke docker / compose.
 */
export function detectDocker(): DockerInfo {
  const info: DockerInfo = {
    installed: false,
    reachable: false,
    needsSg: false,
    composeKind: null,
  };

  info.installed = commandExists('docker');
  if (!info.installed) return info;

  // Can we reach the daemon directly?
  let probe = run('docker', ['version', '--format', '{{.Server.Version}}'], {
    allowFailure: true, alwaysRun: true,
  });
  if (probe.code === 0 && probe.stdout.trim()) {
    info.reachable = true;
    info.version = probe.stdout.trim();
  } else if (commandExists('sg')) {
    // Try via sg docker (user not in docker group but can sg into it).
    const sg = run(
      'sg',
      ['docker', '-c', 'docker version --format "{{.Server.Version}}"'],
      { allowFailure: true, alwaysRun: true },
    );
    if (sg.code === 0 && sg.stdout.trim()) {
      info.reachable = true;
      info.needsSg = true;
      info.version = sg.stdout.trim();
    }
  }

  if (!info.reachable) return info;

  // Detect compose flavor (respecting sg if needed).
  const exec = (s: string): RunResult =>
    info.needsSg
      ? run('sg', ['docker', '-c', s], { allowFailure: true, alwaysRun: true })
      : run('sh', ['-c', s], { allowFailure: true, alwaysRun: true });

  const plugin = exec('docker compose version --short');
  if (plugin.code === 0 && plugin.stdout.trim()) {
    info.composeKind = 'plugin';
    info.composeVersion = plugin.stdout.trim();
  } else if (commandExists('docker-compose')) {
    const standalone = exec('docker-compose version --short');
    if (standalone.code === 0) {
      info.composeKind = 'standalone';
      info.composeVersion = standalone.stdout.trim();
    }
  }

  return info;
}
