import { IsIn, IsOptional } from 'class-validator';

// The app types a bulk patch/migrate wave can be scoped to. Omit `type` to
// target every deployable site regardless of type.
const APP_TYPES = ['static', 'node', 'fullstack', 'nodered', 'frappe'] as const;

export class BulkMigrateDto {
  // Restrict the wave to a single app type (e.g. only Frappe sites). When
  // omitted, all deployable sites across the platform are targeted.
  @IsOptional()
  @IsIn(APP_TYPES)
  type?: (typeof APP_TYPES)[number];
}
