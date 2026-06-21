import { IsString, Matches } from 'class-validator';

export class AddDomainDto {
  // Basic hostname validation: labels of letters/digits/hyphens, at least one dot.
  @IsString()
  @Matches(/^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,}$/, {
    message: 'Enter a valid domain, e.g. app.example.com',
  })
  domain: string;
}
