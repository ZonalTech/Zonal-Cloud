import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/encrypt.util';

// Provisions and reuses a per-app Postgres database inside the platform's
// shared Postgres server. Each app gets a dedicated database AND a dedicated
// login role scoped to that database, so apps are isolated from each other and
// from the platform's own `zonal` database.
//
// Connection model (important): the API process connects to Postgres as the
// admin role over DATABASE_URL (localhost:5432 in dev). App CONTAINERS, however,
// reach Postgres by its in-network service name (postgres:5432 on zonal_net).
// So we run DDL over the admin URL, but the DATABASE_URL we inject into the app
// container uses APP_DB_HOST/APP_DB_PORT.
@Injectable()
export class DbProvisionService {
  private readonly logger = new Logger(DbProvisionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // The host/port an APP CONTAINER uses to reach Postgres. Defaults to the
  // compose service name on the shared zonal_net network.
  private appDbHost(): string {
    return process.env.APP_DB_HOST ?? 'postgres';
  }

  private appDbPort(): number {
    return Number(process.env.APP_DB_PORT ?? 5432);
  }

  // Admin connection string the API uses to run CREATE ROLE / CREATE DATABASE.
  // Defaults to the platform's own DATABASE_URL (the `zonal` superuser).
  private adminConnectionString(): string {
    const url = process.env.APP_DB_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'No admin DB connection string (set DATABASE_URL or APP_DB_ADMIN_URL)',
      );
    }
    return url;
  }

  // Postgres identifiers can't be bound as parameters, so build them from the
  // app subdomain through a strict allowlist and quote them. The subdomain is
  // already validated/unique, but we sanitize defensively. Leading digit is
  // prefixed so the identifier is always valid.
  private safeIdent(subdomain: string, prefix: string): string {
    let base = subdomain.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!base) base = 'app';
    const ident = `${prefix}_${base}`;
    // Postgres identifiers max out at 63 bytes.
    return ident.slice(0, 63);
  }

  // Wrap an identifier in double quotes for safe interpolation. The identifier
  // is already restricted to [a-z0-9_], so this is belt-and-suspenders.
  private quoteIdent(ident: string): string {
    return `"${ident.replace(/"/g, '""')}"`;
  }

  // Ensure an app has a provisioned database + role, creating them idempotently.
  // Returns the AppDatabase record. Safe to call on every deploy.
  async ensureForApp(appId: string, subdomain: string) {
    const existing = await this.prisma.appDatabase.findUnique({
      where: { appId },
    });
    if (existing) {
      // Already provisioned. Make sure the DB/role actually exist (e.g. the row
      // survived a Postgres volume wipe); recreate if missing.
      await this.ensureObjectsExist(existing.dbName, existing.roleName, decrypt(existing.passwordEnc));
      return existing;
    }

    const dbName = this.safeIdent(subdomain, 'db');
    const roleName = this.safeIdent(subdomain, 'app');
    const password = crypto.randomBytes(24).toString('base64url');

    await this.createRoleAndDatabase(dbName, roleName, password);

    const record = await this.prisma.appDatabase.create({
      data: {
        appId,
        dbName,
        roleName,
        passwordEnc: encrypt(password),
        host: this.appDbHost(),
        port: this.appDbPort(),
      },
    });
    this.logger.log(`Provisioned database ${dbName} (role ${roleName}) for app ${appId}`);
    return record;
  }

  // The DATABASE_URL string injected into the app container. Uses the in-network
  // host so the container can reach Postgres over zonal_net.
  buildAppDatabaseUrl(db: {
    roleName: string;
    passwordEnc: string;
    dbName: string;
    host: string;
    port: number;
  }): string {
    const password = decrypt(db.passwordEnc);
    const enc = encodeURIComponent(password);
    return `postgresql://${db.roleName}:${enc}@${db.host}:${db.port}/${db.dbName}`;
  }

  // --- DDL helpers ---------------------------------------------------------

  private async withAdminClient<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = new Pool({ connectionString: this.adminConnectionString() });
    try {
      return await fn(pool);
    } finally {
      await pool.end();
    }
  }

  private async createRoleAndDatabase(
    dbName: string,
    roleName: string,
    password: string,
  ): Promise<void> {
    await this.withAdminClient(async (pool) => {
      const qRole = this.quoteIdent(roleName);
      const qDb = this.quoteIdent(dbName);

      // CREATE ROLE — only if it doesn't exist. The password IS bindable as a
      // string literal via format(), but pg can't parameterize DDL, so we use a
      // safely-escaped literal. quote_literal in a DO block keeps it injection-safe.
      await pool.query(
        `DO $$
         BEGIN
           IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = $tag$${roleName}$tag$) THEN
             EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', $tag$${roleName}$tag$, $tag$${password}$tag$);
           ELSE
             EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', $tag$${roleName}$tag$, $tag$${password}$tag$);
           END IF;
         END
         $$;`,
      );

      // CREATE DATABASE can't run inside a transaction/DO block, so guard with a
      // catalog check first.
      const dbExists = await pool.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName],
      );
      if (dbExists.rowCount === 0) {
        await pool.query(`CREATE DATABASE ${qDb} OWNER ${qRole}`);
      }

      // Make sure the role owns/can use the database and the public schema.
      await pool.query(`GRANT ALL PRIVILEGES ON DATABASE ${qDb} TO ${qRole}`);
    });

    // Grant schema privileges (must connect to the new database to do this).
    await this.grantSchemaPrivileges(dbName, roleName);
  }

  // Connect to the app's own database and give its role full rights on the
  // public schema, so a backend (e.g. Prisma migrate) can create tables.
  private async grantSchemaPrivileges(dbName: string, roleName: string): Promise<void> {
    const adminUrl = new URL(this.adminConnectionString());
    adminUrl.pathname = `/${dbName}`;
    const pool = new Pool({ connectionString: adminUrl.toString() });
    try {
      const qRole = this.quoteIdent(roleName);
      await pool.query(`GRANT ALL ON SCHEMA public TO ${qRole}`);
      await pool.query(`ALTER SCHEMA public OWNER TO ${qRole}`);
    } finally {
      await pool.end();
    }
  }

  // Recreate the DB/role if the row exists but the objects were lost (e.g. the
  // Postgres data volume was reset). Idempotent and best-effort.
  private async ensureObjectsExist(
    dbName: string,
    roleName: string,
    password: string,
  ): Promise<void> {
    await this.withAdminClient(async (pool) => {
      const role = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
      const db = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (role.rowCount && db.rowCount) return;
      this.logger.warn(`DB objects for ${dbName} missing — recreating`);
    });
    await this.createRoleAndDatabase(dbName, roleName, password);
  }
}
