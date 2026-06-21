import { IsString, IsOptional, MinLength } from 'class-validator';

// A git app to fetch onto a Frappe app's bench (bench get-app) and install on
// its site. Added at create time (the first app) or later via the app detail UI.
export class AddFrappeAppDto {
  @IsString()
  @MinLength(1)
  gitUrl: string;

  @IsOptional()
  @IsString()
  branch?: string;

  // Optional Frappe module name (e.g. "erpnext"). Resolved from the repo if
  // omitted.
  @IsOptional()
  @IsString()
  appName?: string;
}

// Change the Frappe framework version the bench is built on (an upgrade or
// downgrade). Applied on the next deploy, which rebuilds the bench on the new
// version and migrates the site.
export class SetFrappeVersionDto {
  @IsString()
  @MinLength(1)
  version: string;
}
