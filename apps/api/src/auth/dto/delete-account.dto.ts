import { IsString } from 'class-validator';

export class DeleteAccountDto {
  // Re-confirm the current password before destroying the account.
  @IsString()
  password: string;
}
