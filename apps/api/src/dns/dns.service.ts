import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PowerDnsClient, PdnsRRSet } from './powerdns.client';
import { CreateZoneDto } from './dto/create-zone.dto';
import {
  UpsertRecordDto,
  DeleteRecordDto,
  SupportedRecordType,
} from './dto/record.dto';

/**
 * Managed DNS hosting. Ownership/billing/quota live in the app DB (DnsZone +
 * Quota.maxDnsZones); the authoritative record data lives in PowerDNS and is
 * read/written through {@link PowerDnsClient}. Every customer-facing method is
 * scoped by organizationId so one org can never touch another's zone.
 */
@Injectable()
export class DnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdns: PowerDnsClient,
    private readonly audit: AuditService,
  ) {}

  /** Bare nameserver hostnames customers must delegate to. */
  private nameservers(): string[] {
    const base = process.env.DNS_BASE_DOMAIN || 'oponde.top';
    const raw =
      process.env.DNS_NAMESERVERS || `ns1.${base},ns2.${base}`;
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  // ---- Zones -------------------------------------------------------------

  async listZones(organizationId: string) {
    const zones = await this.prisma.dnsZone.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const nameservers = this.nameservers();
    return zones.map((z) => ({ ...z, nameservers }));
  }

  /** Look up a zone owned by this org or 404. */
  private async ownedZoneOrThrow(organizationId: string, name: string) {
    const canonical = PowerDnsClient.fromCanonical(name);
    const zone = await this.prisma.dnsZone.findUnique({
      where: { name: canonical },
    });
    if (!zone || zone.organizationId !== organizationId) {
      throw new NotFoundException(`DNS zone ${canonical} not found`);
    }
    return zone;
  }

  async createZone(
    userId: string,
    organizationId: string,
    dto: CreateZoneDto,
  ) {
    const name = PowerDnsClient.fromCanonical(dto.name);

    // Quota: the org must have bought the DNS add-on and have headroom.
    const quota = await this.prisma.quota.findUnique({
      where: { organizationId },
    });
    const maxDnsZones = quota?.maxDnsZones ?? 0;
    if (maxDnsZones <= 0) {
      throw new ForbiddenException(
        'DNS hosting is not enabled for your account. Contact billing to add it.',
      );
    }
    const used = await this.prisma.dnsZone.count({
      where: { organizationId },
    });
    if (used >= maxDnsZones) {
      throw new ForbiddenException(
        `DNS zone limit reached (${used}/${maxDnsZones}). Upgrade to host more domains.`,
      );
    }

    // Uniqueness: a domain can only be hosted once across the whole platform.
    const existing = await this.prisma.dnsZone.findUnique({
      where: { name },
    });
    if (existing) {
      throw new ConflictException(
        `${name} is already hosted on this platform.`,
      );
    }

    // Create in PowerDNS first; only persist ownership if that succeeds, so we
    // never have a DnsZone row pointing at a non-existent backend zone.
    await this.pdns.createZone(name, this.nameservers());

    const zone = await this.prisma.dnsZone.create({
      data: { organizationId, name },
    });

    await this.audit.log({
      actorUserId: userId,
      action: 'dns.zone.create',
      target: name,
      metadata: { organizationId },
    });

    return { ...zone, nameservers: this.nameservers() };
  }

  async deleteZone(
    userId: string,
    organizationId: string,
    name: string,
  ) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);

    await this.pdns.deleteZone(zone.name);
    await this.prisma.dnsZone.delete({ where: { id: zone.id } });

    await this.audit.log({
      actorUserId: userId,
      action: 'dns.zone.delete',
      target: zone.name,
      metadata: { organizationId },
    });

    return { deleted: true };
  }

  // ---- Records -----------------------------------------------------------

  /**
   * List a zone's records as flat, customer-friendly rows: { name, type, ttl,
   * records[] }. The platform-managed SOA is hidden; apex NS are shown read-only.
   */
  async listRecords(organizationId: string, name: string) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    const pdnsZone = await this.pdns.getZone(zone.name);
    if (!pdnsZone) {
      throw new NotFoundException(`DNS zone ${zone.name} not found in backend`);
    }
    const apex = PowerDnsClient.toCanonical(zone.name);
    return (pdnsZone.rrsets ?? [])
      .filter((rr) => rr.type !== 'SOA')
      .map((rr) => ({
        // Present names relative to the zone: apex -> "@", else strip the suffix.
        name: this.relativize(rr.name, apex),
        type: rr.type,
        ttl: rr.ttl,
        records: rr.records.map((r) => r.content),
        // Apex NS records are platform-managed; flag them as read-only in the UI.
        managed: rr.type === 'NS' && rr.name === apex,
      }));
  }

  async upsertRecord(
    userId: string,
    organizationId: string,
    name: string,
    dto: UpsertRecordDto,
  ) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    if (zone.status !== 'active') {
      throw new ForbiddenException(
        'This zone is suspended; record edits are disabled.',
      );
    }

    const fqdn = this.qualify(dto.name, zone.name);
    this.guardManagedRRSet(dto.type, fqdn, zone.name);

    const rrset: PdnsRRSet = {
      name: PowerDnsClient.toCanonical(fqdn),
      type: dto.type,
      ttl: dto.ttl ?? 3600,
      changetype: 'REPLACE',
      records: dto.records.map((content) => ({
        content: this.normalizeContent(dto.type, content),
        disabled: false,
      })),
    };

    await this.pdns.patchRRSets(zone.name, [rrset]);

    await this.audit.log({
      actorUserId: userId,
      action: 'dns.record.upsert',
      target: `${fqdn} ${dto.type}`,
      metadata: { organizationId, count: dto.records.length },
    });

    return { name: this.relativize(rrset.name, PowerDnsClient.toCanonical(zone.name)), type: dto.type, ttl: rrset.ttl, records: dto.records };
  }

  async deleteRecord(
    userId: string,
    organizationId: string,
    name: string,
    dto: DeleteRecordDto,
  ) {
    const zone = await this.ownedZoneOrThrow(organizationId, name);
    if (zone.status !== 'active') {
      throw new ForbiddenException(
        'This zone is suspended; record edits are disabled.',
      );
    }
    const fqdn = this.qualify(dto.name, zone.name);
    this.guardManagedRRSet(dto.type, fqdn, zone.name);

    await this.pdns.patchRRSets(zone.name, [
      {
        name: PowerDnsClient.toCanonical(fqdn),
        type: dto.type,
        ttl: 3600,
        changetype: 'DELETE',
        records: [],
      },
    ]);

    await this.audit.log({
      actorUserId: userId,
      action: 'dns.record.delete',
      target: `${fqdn} ${dto.type}`,
      metadata: { organizationId },
    });

    return { deleted: true };
  }

  // ---- Helpers -----------------------------------------------------------

  /** Resolve a relative sub-name ("@", "www") to a bare FQDN within the zone. */
  private qualify(sub: string, zone: string): string {
    const z = PowerDnsClient.fromCanonical(zone);
    const s = sub.trim().toLowerCase().replace(/\.$/, '');
    if (s === '' || s === '@') return z;
    // Already fully-qualified and inside the zone? keep it.
    if (s === z || s.endsWith(`.${z}`)) return s;
    return `${s}.${z}`;
  }

  /** Inverse of {@link qualify}: render a canonical FQDN relative to the apex. */
  private relativize(canonicalName: string, apexCanonical: string): string {
    const n = PowerDnsClient.fromCanonical(canonicalName);
    const apex = PowerDnsClient.fromCanonical(apexCanonical);
    if (n === apex) return '@';
    return n.endsWith(`.${apex}`) ? n.slice(0, -(apex.length + 1)) : n;
  }

  /**
   * Block edits to platform-managed RRsets: the apex SOA, and apex NS (which
   * delegate to ns1/ns2 and must not be removed). Customers may still add NS on
   * sub-names to delegate sub-zones.
   */
  private guardManagedRRSet(
    type: SupportedRecordType | 'SOA',
    fqdn: string,
    zone: string,
  ) {
    const apex = PowerDnsClient.fromCanonical(zone);
    const isApex = PowerDnsClient.fromCanonical(fqdn) === apex;
    if (type === ('SOA' as SupportedRecordType)) {
      throw new BadRequestException('The SOA record is managed automatically.');
    }
    if (isApex && type === 'NS') {
      throw new BadRequestException(
        'Apex NS records are managed by the platform and cannot be changed.',
      );
    }
    if (isApex && type === 'CNAME') {
      throw new BadRequestException(
        'A CNAME is not allowed at the zone apex (RFC 1034).',
      );
    }
  }

  /**
   * Light normalization/validation per type before handing to PowerDNS. Targets
   * for CNAME/MX/NS/SRV must be FQDNs (trailing dot) for PowerDNS; add it when
   * the value looks like a hostname.
   */
  private normalizeContent(type: SupportedRecordType, content: string): string {
    const c = content.trim();
    const ensureDot = (host: string) =>
      /^[a-z0-9._-]+$/i.test(host) && !host.endsWith('.') ? `${host}.` : host;

    switch (type) {
      case 'CNAME':
      case 'NS':
        return ensureDot(c);
      case 'MX': {
        // "10 mail.example.com" -> "10 mail.example.com."
        const m = c.match(/^(\d+)\s+(\S+)$/);
        if (!m) {
          throw new BadRequestException(
            'MX value must be "<priority> <host>", e.g. "10 mail.example.com".',
          );
        }
        return `${m[1]} ${ensureDot(m[2])}`;
      }
      case 'SRV': {
        // "<prio> <weight> <port> <target>"
        const m = c.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
        if (!m) {
          throw new BadRequestException(
            'SRV value must be "<priority> <weight> <port> <target>".',
          );
        }
        return `${m[1]} ${m[2]} ${m[3]} ${ensureDot(m[4])}`;
      }
      case 'TXT': {
        // PowerDNS requires TXT content to be quoted.
        if (c.startsWith('"') && c.endsWith('"')) return c;
        return `"${c.replace(/"/g, '\\"')}"`;
      }
      default:
        return c;
    }
  }
}
