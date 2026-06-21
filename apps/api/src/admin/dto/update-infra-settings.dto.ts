import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

// Infrastructure settings managed from Admin → Settings → Infrastructure.
// All fields optional (delta update); the MariaDB root password is only
// overwritten when a non-empty value is sent.
export class UpdateInfraSettingsDto {
  @IsOptional()
  @IsString()
  mariadbAdminHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  mariadbAdminPort?: number;

  @IsOptional()
  @IsString()
  mariadbAdminUser?: string;

  @IsOptional()
  @IsString()
  mariadbAdminPassword?: string;

  @IsOptional()
  @IsString()
  appMariadbHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  appMariadbPort?: number;

  @IsOptional()
  @IsString()
  frappeRedisUrl?: string;

  @IsOptional()
  @IsString()
  frappeBaseImage?: string;
}
