import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  name: string;

  // Optional explicit slug; derived from the name when omitted. This is the
  // identifier users type when registering to join the organization.
  @IsOptional()
  @IsString()
  slug?: string;
}
