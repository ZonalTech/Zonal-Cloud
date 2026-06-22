import { IsString, Matches } from 'class-validator';

export class CreateZoneDto {
  // Apex domain to host, e.g. "example.com" or "sub.example.co.ke".
  // Bare hostname (no scheme, no trailing dot), at least two labels.
  @IsString()
  @Matches(/^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/i, {
    message: 'Enter a valid domain, e.g. example.com',
  })
  name: string;
}
