import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  // The user's current password, re-confirmed before we accept a new one.
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}
