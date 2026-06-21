import { IsString, IsIn, IsOptional, MaxLength } from 'class-validator';

// The allowlisted bench actions an admin can run against a Frappe app's
// container. Each maps to a fixed bench command server-side — no arbitrary
// shell. (Curated, auditable; see FrappeAdminService.BENCH_ACTIONS.)
export const BENCH_ACTION_KEYS = [
  'migrate',
  'clear-cache',
  'clear-website-cache',
  'build',
  'backup',
  'list-apps',
  'version',
  'restart',
] as const;

export type BenchActionKey = (typeof BENCH_ACTION_KEYS)[number];

export class RunBenchActionDto {
  @IsString()
  @IsIn(BENCH_ACTION_KEYS as unknown as string[])
  action: BenchActionKey;
}

export class RunSqlDto {
  // A single read-only (SELECT/SHOW/DESCRIBE/EXPLAIN) statement. Enforced
  // server-side; anything else is rejected.
  @IsString()
  @MaxLength(5000)
  query: string;
}

// Manage a Frappe app on the site directly from root access: install or
// uninstall a specific app on the live site. gitUrl optional (install can use a
// known app name already on the bench).
export class SiteAppActionDto {
  @IsString()
  @IsIn(['install', 'uninstall'])
  action: 'install' | 'uninstall';

  @IsString()
  @MaxLength(140)
  appName: string;
}
