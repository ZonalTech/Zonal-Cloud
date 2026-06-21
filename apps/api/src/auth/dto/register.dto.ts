import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  // 3–30 chars, lowercase letters/numbers/underscore/hyphen. Used as a unique
  // human handle distinct from email.
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9_-]{3,30}$/, {
    message:
      'username must be 3–30 chars: lowercase letters, numbers, underscore or hyphen',
  })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Slug of the EXISTING organization to join (registration no longer creates
  // an organization).
  @IsString()
  @MinLength(2)
  organizationSlug: string;
}
