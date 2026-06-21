# zone — Zonal Cloud operator CLI

`zone` installs, runs, and maintains the **Zonal Cloud** platform on a Linux
server. The CLI and the platform are **separate**:

- **`zone`** (this package, `@zonal-cloud/zone`) — a standalone CLI installed
  from npm. It carries its own copy of the deployment files (compose + Traefik
  config) and writes them into a server **data directory**.
- **The platform** — `api`, `dashboard`, and `admin` ship as **prebuilt images**
  pulled from a container registry (GHCR by default). The server runs them as
  containers alongside Traefik + Postgres + Redis. **No platform source is
  needed on the server.**

So the operator never clones the monorepo onto the VPS — they install the CLI,
and the CLI pulls the images.

## Install the CLI

```bash
npm install -g @zonal-cloud/zone
zone --version
```

Or use the bootstrap (installs Node + the CLI, then runs the install):

```bash
curl -fsSL https://raw.githubusercontent.com/ZonalTech/Zonal-Cloud/main/scripts/install.sh \
  | bash -s -- --domain example.com --acme-email you@example.com
```

## Quick start on a server

```bash
zone preflight              # check the server is ready (read-only)
zone install                # pull images + bring everything up (prompts for superadmin)
zone status                 # confirm services are healthy
```

`install` is idempotent — safe to re-run. Existing secrets in the data dir's
`.env` are preserved.

### Where state lives

`zone` writes to a **data directory** (resolved in this order):

1. `ZONAL_DATA_DIR` if set,
2. `/opt/zonal-cloud` when running as root or it is writable,
3. `~/.zonal-cloud` otherwise.

It holds `docker-compose.yml`, `docker-compose.vps.yml`, `traefik.yml`,
`traefik.prod.yml(.template)`, `.env` (0600, with secrets), and `backups/`.

## Cloud VPS install (HTTPS)

On a public server with a domain, pass `--domain`. This switches to
**production / TLS mode**: Traefik serves HTTPS on :443, redirects HTTP→HTTPS,
and obtains free Let's Encrypt certificates for `api.`, `dashboard.`, and
`admin.` + your domain.

```bash
zone install \
  --domain example.com \
  --acme-email you@example.com \
  --install-docker
```

Fully unattended:

```bash
zone install \
  --domain example.com \
  --acme-email you@example.com \
  --admin-email admin@example.com \
  --admin-password 'StrongPass#1' \
  --non-interactive \
  --install-docker
```

**Before running**, point DNS at the server and open the firewall:

- `A`/`AAAA` records for `api.example.com`, `dashboard.example.com`,
  `admin.example.com` → the VPS public IP (a wildcard `*.example.com` covers
  all three).
- Inbound TCP **80 and 443** must be reachable (`sudo ufw allow 80,443/tcp`).

To enable/change TLS on an existing install:

```bash
zone tls --domain example.com --acme-email you@example.com
```

Omit `--domain` for **localhost mode** (`*.localhost`, HTTP only).

## Choosing images

```bash
zone install --registry ghcr.io/zonaltech/zonal-cloud --tag v0.1.0
```

- `--registry` defaults to `ghcr.io/zonaltech/zonal-cloud`.
- `--tag` defaults to `latest`.

Both are stored in `.env` (`ZONAL_REGISTRY`, `ZONAL_TAG`). The frontends are
**generic** images — the API URL is injected at container start from
`ZONAL_API_URL`, so one published image serves any domain (no per-deploy
rebuild). `zone upgrade --tag vX.Y.Z` moves the deployment to a new version.

## Commands

| Command | What it does |
| --- | --- |
| `preflight` | Read-only readiness report: OS, RAM, disk, Docker, ports. Exits non-zero on hard failures. |
| `install` | Full bootstrap: preflight → Docker → write deploy files → `.env`+secrets → pull → up → migrate → superadmin → health. |
| `up [--pull]` / `down [--volumes]` / `restart [service]` | Lifecycle (`down --volumes` destroys data). |
| `status` | Container states + API health probe. |
| `logs [service] [-f] [-n N]` | Tail container logs. |
| `migrate` | Apply pending Prisma migrations (`prisma migrate deploy`). |
| `superadmin [email] [password] [org]` | Create or promote the platform superadmin. |
| `tls --domain D [--acme-email E]` | Enable/update HTTPS (Let's Encrypt) on an existing install. |
| `upgrade [--tag T]` | Refresh deploy files → backup → pull → migrate → restart. |
| `backup [outfile]` | `pg_dump` the database to a gzip file (default: data dir `backups/`). |
| `restore <infile>` | Restore the database from a backup (gzip or plain SQL). |
| `secrets rotate [--db]` | Rotate `JWT_SECRET` (and optionally the Postgres password), then restart. |

Global flags: `--dry-run`, `-V/--version`, `-h/--help`.

## How it works

- **Self-contained CLI.** The compose + Traefik files are bundled in the npm
  package (`templates/`) and materialized into the data dir on `install` /
  `upgrade`. The server needs only Docker + this CLI.
- **Registry images.** The bundled compose references
  `${ZONAL_REGISTRY}/{api,dashboard,admin}:${ZONAL_TAG}`. `install` runs
  `docker compose pull` then `up` — it never builds on the server.
- **Runtime-configured frontends.** Dashboard/admin read
  `window.__ZONAL_CONFIG__.apiUrl`, written to `/config.js` by the image's nginx
  entrypoint from `ZONAL_API_URL`. One image, any domain.
- **Routing & TLS.** With `--domain`, the VPS overlay (`docker-compose.vps.yml`)
  is auto-selected whenever `DOMAIN` is set in `.env`, so every lifecycle
  command targets the right stack. Traefik gets `:443` + a Let's Encrypt
  resolver; `traefik.prod.yml` is rendered from a template with your ACME email.
- **Migrations & superadmin** run inside one-shot `api` containers
  (`compose run --rm api ...`), using the Prisma client + script baked into the
  api image.
- **Docker access.** Auto-detects the `docker compose` plugin vs legacy
  `docker-compose`, and wraps commands in `sg docker -c` when the user is not in
  the docker group.

## Requirements

- Linux (Ubuntu/Debian tested), Docker Engine 24+ with the Compose plugin.
- Node 20+ to run the CLI.
- Root/sudo only for `--install-docker` or writing to `/opt`.
- Registry access: public images need none; private images need
  `docker login <registry>` first.
