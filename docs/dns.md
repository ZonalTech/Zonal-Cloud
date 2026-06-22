# Managed DNS hosting

Zonal Cloud can sell **managed DNS hosting**: a customer who already owns a
domain (e.g. `example.com`) pays to have its DNS zone served by the platform's
authoritative nameservers. The customer points their registrar's NS records at
`ns1.oponde.top` / `ns2.oponde.top`, then manages records (A/AAAA/CNAME/MX/TXT/
NS/SRV/CAA) from the dashboard.

## Architecture

```
Customer ──► API  /v1/dns  ──►  PowerDNS HTTP API (:8081, internal)  ──┐
                │  Prisma: DnsZone (ownership/billing/quota)            │
                ▼                                                       ▼
            Postgres (app db)                pdns container ──► :53 UDP/TCP
                                              gpgsql backend ──► `pdns` db
```

- **PowerDNS Authoritative** (`pdns` service) answers DNS on host port **53**.
  Record data lives in a dedicated **`pdns`** database in the shared Postgres
  (the `gpgsql` backend). PowerDNS is the source of truth for records.
- **The API** never edits DNS tables directly — it drives PowerDNS over its
  **HTTP API** (`http://pdns:8081`, key `PDNS_API_KEY`, internal to `zonal_net`
  only). See [`apps/api/src/dns/`](../apps/api/src/dns/).
- **The app DB** keeps a `DnsZone` row per hosted domain for **ownership, billing
  and quota** (`Quota.maxDnsZones`). It does **not** duplicate record data.

## One-time setup

### 1. Free up port 53 on the host
The systemd stub resolver usually holds 53. Disable just the listener:
```bash
sudo sed -i 's/#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
```

### 2. Set secrets in `.env`
```
PDNS_API_KEY=<long-random-string>
DNS_BASE_DOMAIN=oponde.top
```

### 3. Create the PowerDNS database + schema
```bash
docker compose up -d postgres
./scripts/dns-bootstrap.sh        # creates `pdns` db + loads services/dns/schema.sql
docker compose up -d pdns
```

### 4. Apply the API migration
```bash
cd apps/api && npx prisma migrate deploy
```

### 5. Glue records at the registrar (cloudoon, for oponde.top)
Create the nameserver hostnames and glue so the internet can find them:
```
ns1.oponde.top.  A  209.151.144.92
ns2.oponde.top.  A  209.151.144.92
```
(For real redundancy, `ns2` should be a second host/IP. A single IP works for
launch.) Verify: `dig +short @ns1.oponde.top SOA <a-test-zone>`.

## Selling / enabling for a customer

DNS hosting is gated by `Quota.maxDnsZones` (default **0** = not purchased).
On purchase, an admin sets the allowance, e.g.:
```sql
UPDATE "Quota" SET "maxDnsZones" = 5 WHERE "organizationId" = '<org-id>';
```
The customer can then create up to 5 zones.

## Customer API (`/v1/dns`, JWT-scoped to the org)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `GET`  | `/v1/dns/zones` | — | List org's zones + nameservers to delegate to |
| `POST` | `/v1/dns/zones` | `{ "name": "example.com" }` | Create a zone (quota-checked) |
| `DELETE` | `/v1/dns/zones/:name` | — | Delete zone + all records |
| `GET` | `/v1/dns/zones/:name/records` | — | List records (SOA hidden, apex NS read-only) |
| `PUT` | `/v1/dns/zones/:name/records` | `{ "name":"www", "type":"A", "ttl":3600, "records":["1.2.3.4"] }` | Create/replace an RRset |
| `DELETE` | `/v1/dns/zones/:name/records` | `{ "name":"www", "type":"A" }` | Delete an RRset |

Record values are the full RDATA PowerDNS expects; the API normalizes common
shorthands:
- **A/AAAA**: `1.2.3.4`
- **CNAME/NS**: `target.example.com` (trailing dot added automatically)
- **MX**: `10 mail.example.com`
- **TXT**: `v=spf1 ...` (auto-quoted)
- **SRV**: `10 5 443 host.example.com`
- **CAA**: `0 issue "letsencrypt.org"`

`@` (or empty) = zone apex. A CNAME at the apex and edits to the apex SOA/NS are
rejected (platform-managed).

### Example
```bash
TOKEN=...   # customer JWT
curl -X POST https://api.oponde.top/v1/dns/zones \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"example.com"}'

curl -X PUT https://api.oponde.top/v1/dns/zones/example.com/records \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"@","type":"A","ttl":3600,"records":["209.151.144.92"]}'
```

## Notes & next steps

- **DNSSEC** is available in PowerDNS (`pdnsutil secure-zone`) — not yet wired
  into the API; add a per-zone toggle when needed.
- **Secondary NS**: for production resilience, run a second `pdns` (or a hidden
  primary + AXFR secondaries) on a different host/IP for `ns2`.
- **Billing**: `maxDnsZones` is the single knob. Tie it to your plan/invoicing
  flow (set it when a DNS plan is purchased, reset to 0 on cancellation).
- **Suspension**: set `DnsZone.status = 'suspended'` to block customer edits
  while keeping the zone served; hard-delete removes it from PowerDNS.
