import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

// Admin edits to a user account. All fields optional — only provided ones change.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9_-]{3,30}$/, {
    message:
      'username must be 3–30 chars: lowercase letters, numbers, underscore or hyphen',
  })
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Reassign the user (and their projects) to this organization.
  @IsOptional()
  @IsString()
  organizationId?: string;

  // Set a new password for the user (admin override). Same minimum length as
  // registration. Stored hashed; never persisted in plaintext.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
