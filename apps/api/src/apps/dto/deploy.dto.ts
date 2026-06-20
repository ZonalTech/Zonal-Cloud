import { IsOptional, IsString } from 'class-validator';

export class DeployDto {
  @IsOptional()
  @IsString()
  ref?: string;
}
