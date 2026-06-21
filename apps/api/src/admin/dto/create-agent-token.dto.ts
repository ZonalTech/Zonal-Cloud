import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAgentTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}
