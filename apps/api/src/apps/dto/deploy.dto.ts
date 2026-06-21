import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DeployDto {
  @IsOptional()
  @IsString()
  ref?: string;

  // Migrate: force a clean rebuild (no cache) with a rollback-safe swap that
  // restores the previous container if the new one fails to come up.
  @IsOptional()
  @IsBoolean()
  forceClean?: boolean;
}
