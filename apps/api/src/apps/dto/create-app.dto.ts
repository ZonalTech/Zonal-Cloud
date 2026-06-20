import { IsString, IsOptional, IsEnum, MinLength } from 'class-validator';

export class CreateAppDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(['git', 'upload'])
  source: 'git' | 'upload';

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
}
