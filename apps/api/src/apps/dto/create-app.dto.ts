import { IsString, IsOptional, IsEnum, MinLength } from 'class-validator';

export class CreateAppDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(['git', 'upload'])
  source: 'git' | 'upload';

  // Site type chosen by the user at create time. "static" = nginx-served build
  // (no server process, no DB); "node" = a long-lived Node server (dynamic, no
  // managed DB); "fullstack" = Node server + a managed Postgres provisioned at
  // deploy time; "frappe" = a full Frappe bench built from the repo's apps.json,
  // with a managed MariaDB database + site auto-provisioned at deploy time;
  // "nodered" = a managed Node-RED instance (official image, no source repo) run
  // with a persistent volume; editor accounts are managed from the app page.
  // Defaults to "static" when omitted.
  @IsOptional()
  @IsEnum(['static', 'node', 'fullstack', 'nodered', 'frappe'])
  type?: 'static' | 'node' | 'fullstack' | 'nodered' | 'frappe';

  @IsOptional()
  @IsString()
  repoUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  buildCmd?: string;

  @IsOptional()
  @IsString()
  outputDir?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  // owner/repo of a connected GitHub repository. When set, the API will
  // install a push webhook so commits auto-deploy.
  @IsOptional()
  @IsString()
  githubRepoFullName?: string;

  // For type=frappe: the first app to put on the bench (its primary app). More
  // can be added later from the app detail page. Frappe core is added by the
  // pipeline automatically, so this is an EXTRA app (e.g. erpnext or a custom
  // app). The repo chosen above (repoUrl) is NOT auto-added — Frappe apps are
  // specified explicitly here.
  @IsOptional()
  @IsString()
  frappeGitUrl?: string;

  @IsOptional()
  @IsString()
  frappeBranch?: string;

  // The Frappe framework version the bench is built on (frappe/frappe branch,
  // e.g. "version-15"). Defaults to version-15 when omitted.
  @IsOptional()
  @IsString()
  frappeVersion?: string;
}
