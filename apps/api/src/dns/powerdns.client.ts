import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Thin client for the PowerDNS Authoritative HTTP API (the "zones" endpoints of
 * the v1 API). PowerDNS is the source of truth for record data; this client is
 * how the platform creates zones and edits RRsets. It talks to the in-network
 * pdns container at PDNS_API_URL (default http://pdns:8081) authenticated with
 * the X-API-Key header (PDNS_API_KEY).
 *
 * Docs: https://doc.powerdns.com/authoritative/http-api/
 *
 * Naming: PowerDNS uses canonical names WITH a trailing dot ("example.com.").
 * The rest of the platform uses bare names ("example.com"); convert at this
 * boundary with {@link toCanonical}.
 */

export interface PdnsRecord {
  content: string;
  disabled?: boolean;
}

export interface PdnsRRSet {
  name: string; // canonical, trailing dot
  type: string; // A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, …
  ttl: number;
  records: PdnsRecord[];
  changetype?: 'REPLACE' | 'DELETE';
}

export interface PdnsZone {
  id: string;
  name: string; // canonical, trailing dot
  kind: string; // "Native" | "Master" | "Slave"
  serial: number;
  dnssec: boolean;
  rrsets?: PdnsRRSet[];
}

@Injectable()
export class PowerDnsClient {
  private readonly logger = new Logger(PowerDnsClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly serverId: string;

  constructor() {
    this.baseUrl = (
      process.env.PDNS_API_URL || 'http://pdns:8081'
    ).replace(/\/+$/, '');
    this.apiKey = process.env.PDNS_API_KEY || 'changeme-pdns-api-key';
    this.serverId = process.env.PDNS_SERVER_ID || 'localhost';
  }

  /** "example.com" -> "example.com." (idempotent). */
  static toCanonical(name: string): string {
    const n = name.trim().toLowerCase();
    return n.endsWith('.') ? n : `${n}.`;
  }

  /** "example.com." -> "example.com" (idempotent). */
  static fromCanonical(name: string): string {
    return name.trim().toLowerCase().replace(/\.$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1/servers/${this.serverId}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`PowerDNS API unreachable: ${String(err)}`);
      throw new ServiceUnavailableException(
        'DNS backend is unavailable. Please try again shortly.',
      );
    }

    if (res.status === 204 || res.status === 201 || res.status === 200) {
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    const detail = await res.text().catch(() => '');
    this.logger.warn(
      `PowerDNS ${method} ${path} -> ${res.status} ${detail}`,
    );
    // Surface as a backend error; the service layer maps known cases (409, 404)
    // before calling, so anything here is unexpected.
    throw new ServiceUnavailableException(
      `DNS backend error (${res.status}): ${detail || res.statusText}`,
    );
  }

  /** List all zones known to PowerDNS (canonical names). */
  listZones(): Promise<PdnsZone[]> {
    return this.request<PdnsZone[]>('GET', '/zones');
  }

  /** Fetch one zone with its RRsets, or null if it does not exist. */
  async getZone(name: string): Promise<PdnsZone | null> {
    const id = encodeURIComponent(PowerDnsClient.toCanonical(name));
    try {
      return await this.request<PdnsZone>('GET', `/zones/${id}`);
    } catch (err) {
      // getZone is also used as an existence check; treat backend 404 as null.
      if (
        err instanceof ServiceUnavailableException &&
        /\(404\)/.test(err.message)
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Create a Native zone with the platform's two nameservers and a default SOA.
   * `nameservers` are bare names; they are stored as NS records at the apex.
   */
  createZone(name: string, nameservers: string[]): Promise<PdnsZone> {
    const canonical = PowerDnsClient.toCanonical(name);
    return this.request<PdnsZone>('POST', '/zones', {
      name: canonical,
      kind: 'Native',
      nameservers: nameservers.map((ns) => PowerDnsClient.toCanonical(ns)),
    });
  }

  /** Permanently delete a zone and all its records from PowerDNS. */
  async deleteZone(name: string): Promise<void> {
    const id = encodeURIComponent(PowerDnsClient.toCanonical(name));
    await this.request<void>('DELETE', `/zones/${id}`);
  }

  /**
   * Create/replace or delete RRsets in a zone (PATCH semantics). Each rrset must
   * carry a changetype of REPLACE (create/update) or DELETE.
   */
  async patchRRSets(zone: string, rrsets: PdnsRRSet[]): Promise<void> {
    const id = encodeURIComponent(PowerDnsClient.toCanonical(zone));
    await this.request<void>('PATCH', `/zones/${id}`, { rrsets });
  }
}
