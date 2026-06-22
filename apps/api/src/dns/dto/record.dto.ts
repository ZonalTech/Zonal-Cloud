import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ArrayMinSize,
  Max,
  Min,
  Matches,
} from 'class-validator';

// Record types the platform lets customers manage. SOA/NS at the apex are
// managed by the platform (the SOA is owned by PowerDNS; apex NS point at our
// nameservers) so they are deliberately excluded from customer edits except for
// delegating NS on sub-names.
export const SUPPORTED_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
  'CAA',
] as const;

export type SupportedRecordType = (typeof SUPPORTED_RECORD_TYPES)[number];

/**
 * One RRset = (name, type) with one or more values sharing a TTL — this mirrors
 * how DNS and PowerDNS actually model records (you can't have two TTLs for the
 * same name+type). `name` is relative to the zone or the bare FQDN; "@" or ""
 * means the zone apex.
 */
export class UpsertRecordDto {
  // Sub-name within the zone. "@" or "" = apex. e.g. "www", "mail", "@".
  @IsString()
  @Matches(/^(@|\*|(\*\.)?([a-z0-9_-]{1,63})(\.[a-z0-9_-]{1,63})*)$/i, {
    message: 'Invalid record name',
  })
  name: string;

  @IsIn(SUPPORTED_RECORD_TYPES as unknown as string[], {
    message: `type must be one of: ${SUPPORTED_RECORD_TYPES.join(', ')}`,
  })
  type: SupportedRecordType;

  @IsInt()
  @Min(60)
  @Max(604800)
  @IsOptional()
  ttl?: number = 3600;

  // One or more record values. For MX use "10 mail.example.com.", for SRV
  // "10 5 443 host.example.com.", etc. — i.e. the full RDATA as PowerDNS expects.
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  records: string[];
}

export class DeleteRecordDto {
  @IsString()
  name: string;

  @IsIn(SUPPORTED_RECORD_TYPES as unknown as string[])
  type: SupportedRecordType;
}
