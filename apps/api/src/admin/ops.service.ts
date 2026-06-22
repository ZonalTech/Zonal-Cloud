import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as Docker from 'dockerode';
import { AuditService } from '../common/audit.service';

/**
 * Platform self-operations — trigger `zone` CLI commands on the host from the
 * admin UI, so an operator can upgrade / restart the platform without SSHing
 * into the VPS.
 *
 * HOW: the API container can't run host shell, but it holds the Docker socket.
 * We launch a one-shot helper container based on `docker:cli` (which ships the
 * docker CLI + compose plugin), add Node, install the published `zone` CLI, and
 * run it against the host — mounting the host Docker socket and the platform
 * data dir (/opt/zonal-cloud). The CLI then drives `docker compose` on the host
 * exactly as a human would. The image MUST contain the docker CLI + compose,
 * because the zone CLI shells out to `docker` / `docker compose`.
 *
 * SAFETY:
 *   - superadmin-only (enforced at the controller).
 *   - FIXED allow-list of commands — argv is hard-coded here, never built from
 *     user input, so there is no arbitrary command execution.
 *   - every run is audited (action + actor + exit code).
 */
export type ZoneCommandKey =
  | 'upgrade'
  | 'status'
  | 'restart'
  | 'migratedb'
  | 'backupdb'
  | 'deploymail';

interface ZoneCommandSpec {
  /** argv passed to the `zone` binary (no shell, no interpolation). */
  argv: string[];
  /** Human label for the audit log / UI. */
  label: string;
  /** Whether this mutates the running stack (UI can warn/confirm). */
  mutating: boolean;
  /** Plain-language explanation shown in the confirm modal. */
  description: string;
}

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  // Where the platform's compose files + .env live on the HOST. Mounted into
  // the helper so the CLI operates on the real deployment.
  private readonly dataDir = process.env.ZONAL_DATA_DIR || '/opt/zonal-cloud';
  // CLI package + helper image, overridable for pinning/air-gapped registries.
  // The image MUST carry the docker CLI + compose plugin; `docker:cli` does.
  // Node is added at runtime (Alpine) so the published zone CLI can run.
  private readonly cliPkg = process.env.ZONAL_CLI_PACKAGE || '@zonalcloud/zone';
  private readonly helperImage = process.env.ZONAL_OPS_IMAGE || 'docker:cli';
  private readonly maxOutput = 512 * 1024; // 512KB cap

  // The ONLY commands that can be triggered. argv is fixed.
  private readonly COMMANDS: Record<ZoneCommandKey, ZoneCommandSpec> = {
    upgrade: {
      argv: ['upgrade', '--no-backup'],
      label: 'upgrade',
      mutating: true,
      description:
        'Pulls the latest platform images, refreshes config, frees DNS port 53, ' +
        'runs database migrations, and restarts the stack. Brief downtime is possible.',
    },
    status: {
      argv: ['status'],
      label: 'status',
      mutating: false,
      description: 'Shows the state and health of every platform container. Read-only.',
    },
    restart: {
      argv: ['restart'],
      label: 'restart',
      mutating: true,
      description:
        'Restarts all platform containers without pulling new images. ' +
        'Causes a brief interruption while services come back up.',
    },
    migratedb: {
      argv: ['migrate'],
      label: 'migratedb',
      mutating: true,
      description:
        'Applies any pending database schema migrations (prisma migrate deploy). ' +
        'Run after an upgrade if the schema is behind.',
    },
    backupdb: {
      argv: ['backup'],
      label: 'backupdb',
      mutating: false,
      description:
        'Dumps the Postgres database to a timestamped gzip file in the backups ' +
        'directory on the server. Safe; does not change anything.',
    },
    deploymail: {
      argv: ['up'],
      label: 'deploymail',
      mutating: true,
      description:
        'Brings up any platform services that are defined but not yet running — ' +
        'including the Stalwart mail server — without pulling new images. ' +
        'Use this to deploy mail after it was added to the stack.',
    },
  };

  constructor(private readonly audit: AuditService) {}

  /** Metadata for the UI — the buttons it should render. */
  listCommands(): Array<{
    key: ZoneCommandKey;
    label: string;
    mutating: boolean;
    description: string;
  }> {
    return (Object.keys(this.COMMANDS) as ZoneCommandKey[]).map((key) => ({
      key,
      label: this.COMMANDS[key].label,
      mutating: this.COMMANDS[key].mutating,
      description: this.COMMANDS[key].description,
    }));
  }

  /**
   * Run a single allow-listed zone command on the host via a one-shot helper
   * container. Returns the combined output and exit code.
   *
   * If `onChunk` is supplied, each output chunk is forwarded live as it arrives
   * (used to stream the pull/up progress to the admin UI in real time).
   */
  async runCommand(
    actorUserId: string,
    key: ZoneCommandKey,
    onChunk?: (text: string) => void,
  ): Promise<{ command: string; output: string; exitCode: number }> {
    const spec = this.COMMANDS[key];
    if (!spec) {
      throw new BadRequestException({
        code: 'UNKNOWN_COMMAND',
        message: `Unknown zone command: ${key}`,
      });
    }

    // The helper (docker:cli, Alpine) adds Node, installs the CLI globally, then
    // runs it. ZONAL_DATA_DIR points the CLI at the mounted host data dir; the
    // host docker socket lets its `docker compose` calls act on the real stack.
    const zoneArgs = spec.argv.map((a) => this.shellSafe(a)).join(' ');
    const inner =
      'set -e; ' +
      'command -v node >/dev/null 2>&1 || apk add --no-cache nodejs npm >/tmp/node-install.log 2>&1; ' +
      `npm i -g ${this.shellSafe(this.cliPkg)} >/tmp/cli-install.log 2>&1; ` +
      `zone ${zoneArgs}`;

    await this.pullIfMissing(this.helperImage);

    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-lc', inner],
      Env: [`ZONAL_DATA_DIR=${this.dataDir}`, 'CI=1'],
      WorkingDir: this.dataDir,
      HostConfig: {
        AutoRemove: false, // we remove explicitly after reading the exit code
        Binds: [
          '/var/run/docker.sock:/var/run/docker.sock',
          `${this.dataDir}:${this.dataDir}`,
        ],
        NetworkMode: 'zonal_net',
      },
    });

    let output = '';
    let exitCode = 0;
    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });
      const chunks: Buffer[] = [];
      let total = 0;
      const done = new Promise<void>((resolve, reject) => {
        stream.on('data', (c: Buffer) => {
          if (total < this.maxOutput) {
            chunks.push(c);
            total += c.length;
          }
        });
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });

      await container.start();
      const result = await container.wait();
      exitCode = result.StatusCode ?? 0;
      await done;

      output = Buffer.concat(chunks)
        .toString('utf8')
        // Strip Docker stream-mux headers / control chars, keep \n and \t.
        .replace(/[\x00-\x08\x0b-\x1f]/g, (m) => (m === '\n' || m === '\t' ? m : ''))
        .slice(0, this.maxOutput);
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }

    await this.audit.log({
      actorUserId,
      action: `platform.ops.${key}`,
      target: 'platform',
      metadata: { exitCode },
    });

    return { command: `zone ${spec.argv.join(' ')}`, output, exitCode };
  }

  /**
   * Get the Stalwart mail server's current admin credentials to show the user.
   *
   * Stalwart 0.16+ does NOT use FALLBACK_ADMIN_*. The recovery/bootstrap admin
   * is pinned via STALWART_RECOVERY_ADMIN="user:password" (applied every start);
   * if unset, Stalwart generates a RANDOM temporary password and prints it once
   * in its logs ("Stalwart bootstrap mode … password: <pw>").
   *
   * So we report the active credentials by, in order:
   *   1. the pinned STALWART_RECOVERY_ADMIN from the container's env, else
   *   2. the temporary password parsed from the container logs, else
   *   3. unknown (tell the user to check `docker logs stalwart`).
   *
   * Read-only: this never changes anything, it just surfaces the password.
   */
  async getMailAdmin(): Promise<{
    username: string;
    password: string | null;
    source: 'pinned' | 'bootstrap-log' | 'unknown';
  }> {
    let container: Docker.Container;
    let info: Docker.ContainerInspectInfo;
    try {
      container = this.docker.getContainer('stalwart');
      info = await container.inspect();
    } catch {
      throw new BadRequestException({
        code: 'MAIL_NOT_DEPLOYED',
        message: 'The mail server is not running. Deploy it first (deploymail).',
      });
    }

    // 1. Pinned recovery admin from env, e.g. STALWART_RECOVERY_ADMIN=admin:secret.
    const envs = info.Config?.Env ?? [];
    const pin = envs
      .map((e) => /^STALWART_RECOVERY_ADMIN=(.*)$/.exec(e)?.[1])
      .find((v): v is string => !!v);
    if (pin && pin.includes(':')) {
      const idx = pin.indexOf(':');
      const u = pin.slice(0, idx);
      const p = pin.slice(idx + 1);
      // Treat the shipped placeholder as "not really set".
      if (p && p !== 'changeme-mail-admin') {
        return { username: u || 'admin', password: p, source: 'pinned' };
      }
    }

    // 2. Parse the temporary bootstrap password from the container logs.
    try {
      const buf = (await container.logs({
        stdout: true,
        stderr: true,
        tail: 200,
      })) as unknown as Buffer;
      const text = buf
        .toString('utf8')
        .replace(/[\x00-\x08\x0b-\x1f]/g, (m) => (m === '\n' ? m : ' '));
      const userM = /username:\s*([^\s]+)/i.exec(text);
      const passM = /password:\s*([^\s]+)/i.exec(text);
      if (passM) {
        return {
          username: userM?.[1] || 'admin',
          password: passM[1],
          source: 'bootstrap-log',
        };
      }
    } catch {
      /* fall through */
    }

    return { username: 'admin', password: null, source: 'unknown' };
  }

  /** Pull the helper image if it isn't present locally. */
  private async pullIfMissing(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch {
      /* not present — pull */
    }
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (e: Error | null) =>
          e ? reject(e) : resolve(),
        );
      });
    });
  }

  /** Reject anything that isn't a plain token (defence-in-depth; argv is fixed). */
  private shellSafe(s: string): string {
    if (!/^[A-Za-z0-9@._/+-]+$/.test(s)) {
      throw new BadRequestException({ code: 'BAD_ARG', message: `Unsafe argument: ${s}` });
    }
    return s;
  }
}
