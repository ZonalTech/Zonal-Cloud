import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as mysql from 'mysql2/promise';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/encrypt.util';
import { PlatformSettingsService } from '../common/platform-settings.service';

// Provisions and reuses a per-app MariaDB database inside the platform's shared
// MariaDB server. This is the MariaDB analogue of DbProvisionService (Postgres):
// Frappe's first-class database is MariaDB, so frappe-type apps get a dedicated
// database AND a dedicated login user scoped to that database here.
//
// Connection model (same split as the Postgres provisioner): the API process
// runs DDL (CREATE DATABASE / CREATE USER) against MariaDB as the ROOT/admin
// user over MARIADB_ADMIN_* (localhost:3306 in dev). App CONTAINERS reach
// MariaDB by its in-network service name (mariadb:3306 on zonal_net), so the
// credentials we hand to the container use APP_MARIADB_HOST/APP_MARIADB_PORT.
//
// Note: `bench new-site` needs the MariaDB ROOT password (Frappe creates the
// site database + user itself during bootstrap). We expose adminCredentials()
// for the deploy pipeline to inject MYSQL_ROOT_PASSWORD into the bench step. We
// ALSO pre-create a scoped database/user here so the running site has stable
// credentials independent of root and so teardown is straightforward.
@Injectable()
export class MariadbProvisionService {
  private readonly logger = new Logger(MariadbProvisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // The host/port an APP CONTAINER uses to reach MariaDB. Defaults to the
  // compose service name on the shared zonal_net network. DB-first, env-fallback.
  async appDbHost(): Promise<string> {
    return this.settings.appMariadbHost();
  }

  async appDbPort(): Promise<number> {
    return this.settings.appMariadbPort();
  }

  // Admin (root) connection info the API uses to run DDL and that `bench
  // new-site` needs to bootstrap a Frappe site. Host/port here is how the API
  // (host-run in dev) reaches MariaDB; the bench step inside a container uses
  // appDbHost()/appDbPort() instead. Resolved DB-first (admin UI), env-fallback.
  async adminCredentials(): Promise<{
    host: string;
    port: number;
    user: string;
    password: string;
  }> {
    const password = await this.settings.mariadbAdminPassword();
    if (!password) {
      throw new Error(
        'No MariaDB admin password configured. Set it in Admin → Settings → ' +
          'Infrastructure (or MARIADB_ADMIN_PASSWORD in env).',
      );
    }
    return {
      host: await this.settings.mariadbAdminHost(),
      port: await this.settings.mariadbAdminPort(),
      user: await this.settings.mariadbAdminUser(),
      password,
    };
  }

  // MySQL identifiers (db name, user name) can't be bound as parameters, so we
  // build them from the app subdomain through a strict allowlist. Leading digit
  // is prefixed so the identifier is always valid. MySQL db/user names cap at 64
  // chars.
  private safeIdent(subdomain: string, prefix: string): string {
    let base = subdomain.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!base) base = 'app';
    return `${prefix}_${base}`.slice(0, 64);
  }

  // Backtick-quote an identifier for safe interpolation. The identifier is
  // already restricted to [a-z0-9_], so this is belt-and-suspenders.
  private quoteIdent(ident: string): string {
    return `\`${ident.replace(/`/g, '``')}\``;
  }

  // Ensure an app has a provisioned database + user, creating them idempotently.
  // Returns the FrappeDatabase record. Safe to call on every deploy.
  async ensureForApp(appId: string, subdomain: string) {
    const existing = await this.prisma.frappeDatabase.findUnique({
      where: { appId },
    });
    if (existing) {
      // Already provisioned. Make sure the objects actually exist (e.g. the row
      // survived a MariaDB volume wipe); recreate if missing.
      await this.createDatabaseAndUser(
        existing.dbName,
        existing.userName,
        decrypt(existing.passwordEnc),
      );
      return existing;
    }

    const dbName = this.safeIdent(subdomain, 'db');
    const userName = this.safeIdent(subdomain, 'app');
    const password = crypto.randomBytes(24).toString('base64url');

    await this.createDatabaseAndUser(dbName, userName, password);

    const record = await this.prisma.frappeDatabase.create({
      data: {
        appId,
        dbName,
        userName,
        passwordEnc: encrypt(password),
        host: await this.appDbHost(),
        port: await this.appDbPort(),
      },
    });
    this.logger.log(
      `Provisioned MariaDB database ${dbName} (user ${userName}) for app ${appId}`,
    );
    return record;
  }

  // The plaintext password for the app's scoped MariaDB user (decrypted on
  // demand). Used by the deploy pipeline to build the connection env it injects.
  appUserPassword(db: { passwordEnc: string }): string {
    return decrypt(db.passwordEnc);
  }

  // Drop the app's database + user. Best-effort; used on app deletion.
  async dropForApp(dbName: string, userName: string): Promise<void> {
    await this.withAdminConnection(async (conn) => {
      await conn.query(`DROP DATABASE IF EXISTS ${this.quoteIdent(dbName)}`);
      // Drop the user on every host MariaDB may have created it for.
      await conn.query(`DROP USER IF EXISTS ${this.quoteUser(userName)}`);
      await conn.query("FLUSH PRIVILEGES");
    });
  }

  // --- DDL helpers ---------------------------------------------------------

  private async withAdminConnection<T>(
    fn: (conn: mysql.Connection) => Promise<T>,
  ): Promise<T> {
    const admin = await this.adminCredentials();
    const conn = await mysql.createConnection({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
      multipleStatements: false,
    });
    try {
      return await fn(conn);
    } finally {
      await conn.end();
    }
  }

  // Quote a user as `name`@`%`. The name is already restricted to [a-z0-9_].
  private quoteUser(userName: string): string {
    return `${this.quoteIdent(userName)}@\`%\``;
  }

  private async createDatabaseAndUser(
    dbName: string,
    userName: string,
    password: string,
  ): Promise<void> {
    await this.withAdminConnection(async (conn) => {
      const qDb = this.quoteIdent(dbName);
      const qUser = this.quoteUser(userName);

      // CREATE DATABASE ... IF NOT EXISTS is idempotent. Frappe expects utf8mb4.
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS ${qDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );

      // CREATE USER with an escaped string-literal password. The password is a
      // base64url random string (no quotes/backslashes), but escape defensively.
      const escPass = password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      await conn.query(
        `CREATE USER IF NOT EXISTS ${qUser} IDENTIFIED BY '${escPass}'`,
      );
      // Reset the password too, in case the user pre-existed (recreate path).
      await conn.query(`ALTER USER ${qUser} IDENTIFIED BY '${escPass}'`);

      // Frappe needs broad rights on its own DB (it creates/alters/drops tables
      // and indexes during migrations).
      await conn.query(`GRANT ALL PRIVILEGES ON ${qDb}.* TO ${qUser}`);
      await conn.query("FLUSH PRIVILEGES");
    });
  }
}
