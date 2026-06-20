import { IsEnum } from 'class-validator';

export class UpdateRoleDto {
  @IsEnum(['user', 'admin', 'superadmin'])
  role: 'user' | 'admin' | 'superadmin';
}
