import { IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  // Base URL the MCP/agent uses to reach the Zonal API (e.g. http://localhost:4000).
  @IsOptional()
  @IsString()
  agentApiUrl?: string;

  // New agent token. Omit or leave empty to keep the existing one.
  @IsOptional()
  @IsString()
  agentToken?: string;
}
