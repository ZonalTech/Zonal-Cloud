import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateAppDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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
}
