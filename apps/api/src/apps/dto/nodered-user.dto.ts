import { IsString, IsOptional, IsIn, MinLength, Matches } from 'class-validator';

// Node-RED editor account payloads (type = nodered).
//
// Username is restricted to a safe identifier so it can be rendered into
// settings.js without escaping concerns and used as a stable record key.
// Permission is Node-RED's adminAuth level: "*" = full access, "read" =
// read-only.
export class AddNodeRedUserDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{1,32}$/, {
    message:
      'Username must be 1-32 chars of letters, numbers, dot, underscore or hyphen',
  })
  username: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @IsOptional()
  @IsIn(['*', 'read'])
  permission?: '*' | 'read';
}

// Update an existing account. Both fields are optional — send a new password to
// rotate it, a new permission to change the access level, or both.
export class UpdateNodeRedUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;

  @IsOptional()
  @IsIn(['*', 'read'])
  permission?: '*' | 'read';
}
