import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from './encrypt.util';

// Setting keys for platform infrastructure config that admins can manage from
// the UI (instead of editing .env + restarting). Values are stored in the
// generic `Setting` table; secrets are stored encrypted.
export const SETTING_MARIADB_ADMIN_HOST = 'mariadb_admin_host';
export const SETTING_MARIADB_ADMIN_PORT = 'mariadb_admin_port';
export const SETTING_MARIADB_ADMIN_USER = 'mariadb_admin_user';
export const SETTING_MARIADB_ADMIN_PASSWORD = 'mariadb_admin_password'; // encrypted
export const SETTING_APP_MARIADB_HOST = 'app_mariadb_host';
export const SETTING_APP_MARIADB_PORT = 'app_mariadb_port';
export const SETTING_FRAPPE_REDIS_URL = 'frappe_redis_url';
export const SETTING_FRAPPE_BASE_IMAGE = 'frappe_base_image';

// Reads/writes platform infrastructure settings with a DB-first, env-fallback
// resolution: a value set via the admin UI (DB) wins; otherwise the process env
// is used; otherwise a sane default. This lets the MariaDB root password and
// Frappe base image be configured from the UI without editing .env.
@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async raw(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) return null;
    return row.encrypted ? decrypt(row.value) : row.value;
  }

  // Resolve a setting: DB value, else env var, else default.
  private async resolve(
    key: string,
    envName: string,
    fallback: string,
  ): Promise<string> {
    const dbVal = await this.raw(key);
    if (dbVal !== null && dbVal !== '') return dbVal;
    const envVal = process.env[envName];
    if (envVal !== undefined && envVal !== '') return envVal;
    return fallback;
  }

  async mariadbAdminHost(): Promise<string> {
    return this.resolve(SETTING_MARIADB_ADMIN_HOST, 'MARIADB_ADMIN_HOST', '127.0.0.1');
  }

  async mariadbAdminPort(): Promise<number> {
    return Number(
      await this.resolve(SETTING_MARIADB_ADMIN_PORT, 'MARIADB_ADMIN_PORT', '3306'),
    );
  }

  async mariadbAdminUser(): Promise<string> {
    return this.resolve(SETTING_MARIADB_ADMIN_USER, 'MARIADB_ADMIN_USER', 'root');
  }

  // Returns the root password, or null if neither DB nor env has one set.
  async mariadbAdminPassword(): Promise<string | null> {
    const dbVal = await this.raw(SETTING_MARIADB_ADMIN_PASSWORD);
    if (dbVal !== null && dbVal !== '') return dbVal;
    const envVal = process.env.MARIADB_ADMIN_PASSWORD;
    return envVal && envVal !== '' ? envVal : null;
  }

  async appMariadbHost(): Promise<string> {
    return this.resolve(SETTING_APP_MARIADB_HOST, 'APP_MARIADB_HOST', 'mariadb');
  }

  async appMariadbPort(): Promise<number> {
    return Number(
      await this.resolve(SETTING_APP_MARIADB_PORT, 'APP_MARIADB_PORT', '3306'),
    );
  }

  async frappeRedisUrl(): Promise<string> {
    return this.resolve(SETTING_FRAPPE_REDIS_URL, 'FRAPPE_REDIS_URL', 'redis://redis:6379');
  }

  async frappeBaseImage(): Promise<string> {
    return this.resolve(SETTING_FRAPPE_BASE_IMAGE, 'FRAPPE_BASE_IMAGE', 'frappe/build:version-15');
  }

  // --- Writes (admin UI) ---------------------------------------------------

  private async set(key: string, value: string, encrypted: boolean): Promise<void> {
    const stored = encrypted ? encrypt(value) : value;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: stored, encrypted },
      update: { value: stored, encrypted },
    });
  }

  // Returns the current infra settings for the UI. The root password is never
  // returned in plaintext — only whether one is set.
  async getInfraSettings() {
    return {
      mariadbAdminHost: await this.mariadbAdminHost(),
      mariadbAdminPort: await this.mariadbAdminPort(),
      mariadbAdminUser: await this.mariadbAdminUser(),
      mariadbAdminPasswordSet: (await this.mariadbAdminPassword()) !== null,
      appMariadbHost: await this.appMariadbHost(),
      appMariadbPort: await this.appMariadbPort(),
      frappeRedisUrl: await this.frappeRedisUrl(),
      frappeBaseImage: await this.frappeBaseImage(),
    };
  }

  // Upsert infra settings from the admin UI. Only provided fields are written;
  // the password is only overwritten when a non-empty value is supplied.
  async updateInfraSettings(dto: {
    mariadbAdminHost?: string;
    mariadbAdminPort?: number;
    mariadbAdminUser?: string;
    mariadbAdminPassword?: string;
    appMariadbHost?: string;
    appMariadbPort?: number;
    frappeRedisUrl?: string;
    frappeBaseImage?: string;
  }) {
    if (dto.mariadbAdminHost !== undefined)
      await this.set(SETTING_MARIADB_ADMIN_HOST, dto.mariadbAdminHost, false);
    if (dto.mariadbAdminPort !== undefined)
      await this.set(SETTING_MARIADB_ADMIN_PORT, String(dto.mariadbAdminPort), false);
    if (dto.mariadbAdminUser !== undefined)
      await this.set(SETTING_MARIADB_ADMIN_USER, dto.mariadbAdminUser, false);
    if (dto.mariadbAdminPassword)
      await this.set(SETTING_MARIADB_ADMIN_PASSWORD, dto.mariadbAdminPassword, true);
    if (dto.appMariadbHost !== undefined)
      await this.set(SETTING_APP_MARIADB_HOST, dto.appMariadbHost, false);
    if (dto.appMariadbPort !== undefined)
      await this.set(SETTING_APP_MARIADB_PORT, String(dto.appMariadbPort), false);
    if (dto.frappeRedisUrl !== undefined)
      await this.set(SETTING_FRAPPE_REDIS_URL, dto.frappeRedisUrl, false);
    if (dto.frappeBaseImage !== undefined)
      await this.set(SETTING_FRAPPE_BASE_IMAGE, dto.frappeBaseImage, false);

    return this.getInfraSettings();
  }
}
