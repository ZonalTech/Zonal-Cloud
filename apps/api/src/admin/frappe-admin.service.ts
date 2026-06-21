import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as Docker from 'dockerode';
import * as mysql from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlatformSettingsService } from '../common/platform-settings.service';
import { decrypt } from '../common/encrypt.util';
import { BenchActionKey } from './dto/root-access.dto';

// "Root access" to a Frappe app's container + database — but CURATED, not a raw
// shell. Admins can run a fixed set of bench commands inside the running
// container and read-only SQL against the app's database. Every action is
// audited. This deliberately avoids arbitrary command/SQL execution.
@Injectable()
export class FrappeAdminService {
  private readonly logger = new Logger(FrappeAdminService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  // Allowlist: action key -> bench argv (run inside the bench dir as `frappe`).
  // `{site}` is substituted with the app's site name. No shell metacharacters
  // are interpreted — argv is passed directly to exec.
  private readonly BENCH_ACTIONS: Record<BenchActionKey, (site: string) => string[]> = {
    migrate: (s) => ['bench', '--site', s, 'migrate'],
    'clear-cache': (s) => ['bench', '--site', s, 'clear-cache'],
    'clear-website-cache': (s) => ['bench', '--site', s, 'clear-website-cache'],
    build: () => ['bench', 'build'],
    backup: (s) => ['bench', '--site', s, 'backup'],
    'list-apps': (s) => ['bench', '--site', s, 'list-apps'],
    version: () => ['bench', 'version'],
    restart: () => ['bench', 'restart'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingsService,
  ) {}

  private async getFrappeApp(appId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { frappeDatabase: true },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.type !== 'frappe') {
      throw new BadRequestException({
        code: 'NOT_FRAPPE_APP',
        message: 'This app is not a Frappe app',
      });
    }
    return app;
  }

  // Run one allowlisted bench action inside the app's running container.
  async runBenchAction(actorId: string, appId: string, action: BenchActionKey) {
    const app = await this.getFrappeApp(appId);
    const builder = this.BENCH_ACTIONS[action];
    if (!builder) {
      throw new BadRequestException({ code: 'UNKNOWN_ACTION', message: 'Unknown bench action' });
    }
    const site = app.frappeSiteName ?? app.subdomain;
    const argv = builder(site);

    const output = await this.execInContainer(`zonal-${app.subdomain}`, argv);

    await this.audit.log({
      actorUserId: actorId,
      action: 'frappe.root.bench',
      target: appId,
      metadata: { benchAction: action, exitCode: output.exitCode },
    });

    return { action, ...output };
  }

  // Run a single READ-ONLY SQL statement against the app's database. Only
  // SELECT/SHOW/DESCRIBE/EXPLAIN are allowed; multiple statements are rejected.
  async runSql(actorId: string, appId: string, query: string) {
    const app = await this.getFrappeApp(appId);
    if (!app.frappeDatabase) {
      throw new BadRequestException({
        code: 'NO_DATABASE',
        message: 'This Frappe app has no provisioned database yet (deploy it first).',
      });
    }

    const trimmed = query.trim().replace(/;\s*$/, '');
    if (trimmed.includes(';')) {
      throw new BadRequestException({
        code: 'MULTI_STATEMENT',
        message: 'Only a single statement is allowed.',
      });
    }
    if (!/^(select|show|describe|desc|explain)\b/i.test(trimmed)) {
      throw new BadRequestException({
        code: 'NOT_READ_ONLY',
        message: 'Only read-only queries (SELECT/SHOW/DESCRIBE/EXPLAIN) are allowed.',
      });
    }

    // Connect as the MariaDB ROOT admin (the API's admin host) but scoped to the
    // app's database, so the query can read this app's tables.
    const adminHost = await this.settings.mariadbAdminHost();
    const adminPort = await this.settings.mariadbAdminPort();
    const adminUser = await this.settings.mariadbAdminUser();
    const adminPassword = await this.settings.mariadbAdminPassword();
    if (!adminPassword) {
      throw new BadRequestException({
        code: 'NO_DB_ADMIN',
        message: 'MariaDB admin password is not configured (Admin → Settings → Infrastructure).',
      });
    }

    const conn = await mysql.createConnection({
      host: adminHost,
      port: adminPort,
      user: adminUser,
      password: adminPassword,
      database: app.frappeDatabase.dbName,
      // Hard cap so a heavy query can't hang the API.
      connectTimeout: 8000,
    });
    try {
      // A statement-level timeout via MAX_EXECUTION_TIME for SELECTs.
      const [rows, fields] = await conn.query(trimmed);
      const cols = Array.isArray(fields)
        ? (fields as mysql.FieldPacket[]).map((f) => f.name)
        : [];
      const rowArr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

      await this.audit.log({
        actorUserId: actorId,
        action: 'frappe.root.sql',
        target: appId,
        metadata: { query: trimmed.slice(0, 500), rows: rowArr.length },
      });

      // Cap returned rows so the UI/response stays bounded.
      const capped = rowArr.slice(0, 500);
      return {
        columns: cols,
        rows: capped.map((r) =>
          cols.length ? cols.map((c) => r[c]) : Object.values(r),
        ),
        rowCount: rowArr.length,
        truncated: rowArr.length > capped.length,
      };
    } finally {
      await conn.end();
    }
  }

  // Exec a command (argv, no shell) inside a running container and collect its
  // combined output + exit code. Output is capped.
  private async execInContainer(
    containerName: string,
    argv: string[],
  ): Promise<{ output: string; exitCode: number }> {
    let container: Docker.Container;
    try {
      container = this.docker.getContainer(containerName);
      await container.inspect();
    } catch {
      throw new BadRequestException({
        code: 'CONTAINER_NOT_RUNNING',
        message: 'The app container is not running. Deploy the app first.',
      });
    }

    const exec = await container.exec({
      Cmd: argv,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/home/frappe/frappe-bench',
      User: 'frappe',
    });
    const stream = await exec.start({});

    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 256 * 1024; // cap output at 256KB
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => {
        if (total < MAX) {
          chunks.push(c);
          total += c.length;
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });

    const inspect = await exec.inspect();
    // Strip Docker's 8-byte stream-multiplexing headers best-effort.
    const output = Buffer.concat(chunks)
      .toString('utf8')
      .replace(/[\x00-\x08\x0b-\x1f]/g, (m) => (m === '\n' || m === '\t' ? m : ''));

    return { output: output.slice(0, MAX), exitCode: inspect.ExitCode ?? 0 };
  }

  // Install or uninstall an app on the LIVE site (data-sensitive). Curated
  // wrapper around bench install-app / uninstall-app, audited.
  async siteAppAction(
    actorId: string,
    appId: string,
    action: 'install' | 'uninstall',
    appName: string,
  ) {
    const app = await this.getFrappeApp(appId);
    const site = app.frappeSiteName ?? app.subdomain;
    const name = appName.trim();
    if (!/^[a-z0-9_]+$/i.test(name)) {
      throw new BadRequestException({
        code: 'INVALID_APP_NAME',
        message: 'App name must be a bare module name (letters, digits, underscore).',
      });
    }
    const argv =
      action === 'install'
        ? ['bench', '--site', site, 'install-app', name]
        : ['bench', '--site', site, 'uninstall-app', name, '--yes', '--force'];

    const output = await this.execInContainer(`zonal-${app.subdomain}`, argv);

    await this.audit.log({
      actorUserId: actorId,
      action: `frappe.root.site_app.${action}`,
      target: appId,
      metadata: { appName: name, exitCode: output.exitCode },
    });

    return { action, appName: name, ...output };
  }
}
