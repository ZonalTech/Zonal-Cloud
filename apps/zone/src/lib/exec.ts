/**
 * Process execution helpers.
 *
 * All shelling-out goes through here so behavior (streaming, capture, dry-run)
 * is consistent. Commands are run with argv arrays (no shell) wherever possible
 * to avoid injection and quoting bugs.
 */
import { spawn, spawnSync } from 'node:child_process';

export interface RunOptions {
  /** Working directory. */
  cwd?: string;
  /** Extra environment variables (merged over process.env). */
  env?: NodeJS.ProcessEnv;
  /** Stream stdout/stderr to the parent terminal instead of capturing. */
  inherit?: boolean;
  /** Feed this string to the child's stdin. */
  input?: string;
  /** Continue (return the result) on non-zero exit instead of throwing. */
  allowFailure?: boolean;
  /** Execute even under --dry-run. Use only for read-only probes/detection. */
  alwaysRun?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

let dryRun = false;
export function setDryRun(value: boolean): void {
  dryRun = value;
}
export function isDryRun(): boolean {
  return dryRun;
}

function fmt(cmd: string, args: string[]): string {
  return [cmd, ...args]
    .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
    .join(' ');
}

/** Run a command and capture output. Throws on non-zero unless allowFailure. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): RunResult {
  if (dryRun && !opts.alwaysRun) {
    process.stdout.write('  [dry-run] ' + fmt(cmd, args) + '\n');
    return { code: 0, stdout: '', stderr: '' };
  }
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    input: opts.input,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    if (opts.allowFailure) {
      return { code: 127, stdout: '', stderr: String(res.error.message) };
    }
    throw new Error(`Failed to run "${fmt(cmd, args)}": ${res.error.message}`);
  }
  const result: RunResult = {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
  if (result.code !== 0 && !opts.allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `Command failed (exit ${result.code}): ${fmt(cmd, args)}` +
        (detail ? `\n${detail}` : ''),
    );
  }
  return result;
}

/** Run a command, streaming output live. Resolves with the exit code. */
export function runStream(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<number> {
  if (dryRun) {
    process.stdout.write('  [dry-run] ' + fmt(cmd, args) + '\n');
    return Promise.resolve(0);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** True if a command exists on PATH. */
export function commandExists(cmd: string): boolean {
  const res = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim().length > 0;
}
