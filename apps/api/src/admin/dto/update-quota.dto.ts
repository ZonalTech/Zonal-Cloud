import { IsOptional, IsInt, IsString, Min } from 'class-validator';

export class UpdateQuotaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxApps?: number;

  @IsOptional()
  @IsString()
  cpu?: string;

  @IsOptional()
  @IsString()
  memory?: string;

  @IsOptional()
  @IsString()
  disk?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  buildMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrentDeploys?: number;

  // Managed-DNS add-on: number of zones the org may host. 0 = add-on disabled.
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDnsZones?: number;
}
