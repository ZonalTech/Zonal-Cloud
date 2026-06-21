import { IsString } from 'class-validator';

export class LoginDto {
  // Accepts either an email address or a username. The field is named `email`
  // for backwards compatibility with both frontends, which post `{ email }`.
  @IsString()
  email: string;

  @IsString()
  password: string;
}
