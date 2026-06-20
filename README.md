# Zonal Cloud

A self-hosted, multi-tenant Platform-as-a-Service for full-stack web deployment. It builds
and runs static frontends, Node.js backends, full-stack apps, and Node-RED instances in
Docker, with a reverse proxy that gives every app its own URL. It runs the same way on a
local machine and on an Ubuntu VPS.

This document covers installation (local and VPS), prerequisites, how to access the
dashboard and the admin panel, and the database setup.

> Status: Step 1 vertical slice. The static app type is functional end to end. Other app
> types (Node backend, full-stack, Node-RED) are scaffolded and arrive in later steps.

---

## Contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Database](#database)
- [Prerequisites](#prerequisites)
- [Local installation](#local-installation)
- [Accessing the dashboard and admin panel](#accessing-the-dashboard-and-admin-panel)
- [VPS installation (Ubuntu)](#vps-installation-ubuntu)
- [GitHub Actions auto-deploy](#github-actions-auto-deploy)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Architecture at a glance

| Component | Tech | Default port | Purpose |
| --- | --- | --- | --- |
| API (control plane) | NestJS + Prisma + BullMQ | 4000 | Auth, apps, deploys, admin, deploy engine |
| User dashboard | React + Vite + Tailwind | 5173 | Tenant-facing app management |
| Admin panel | React + Vite + Tailwind | 5174 | Operator control across all tenants |
| Reverse proxy | Traefik v3 | 80 (and 8080 dashboard) | Routes each app at `<slug>.localhost` |
| Database | PostgreSQL 16 | 5432 | Platform data (users, apps, deploys, audit) |
| Queue / cache | Redis 7 | 6379 | Build job queue and log buffering |

Infrastructure (Traefik, PostgreSQL, Redis) runs via `docker-compose.yml`. The API and the
two frontends run as Node processes in development.

---

## Database

The control plane uses **PostgreSQL 16**.

PostgreSQL was chosen because the control plane is write-heavy and concurrent (many deploys
and log writes at once), stores semi-structured data such as audit metadata in `JSONB`, and
needs strict transactional integrity for a multi-tenant, billable system. It is the standard
choice for PaaS control planes.

Note on MariaDB/MySQL: while the platform itself runs on PostgreSQL, MariaDB and MySQL are
planned as databases that can be provisioned for the user apps you deploy (the full-stack app
type, a later step). The control-plane database and the per-app databases are independent.

The schema is managed by Prisma. Migrations are applied with `npm run prisma:migrate` from
`apps/api`. You never write SQL by hand to set this up.

---

## Prerequisites

Required on any machine (local or VPS):

| Tool | Minimum version | Check | Notes |
| --- | --- | --- | --- |
| Docker Engine | 24+ | `docker --version` | Runs Traefik, PostgreSQL, Redis, and deployed app containers |
| Docker Compose | v2 (plugin) | `docker compose version` | Bundled with modern Docker |
| Node.js | 20+ (24 recommended) | `node --version` | Runs the API and frontends |
| npm | 10+ | `npm --version` | Ships with Node |
| Git | any recent | `git --version` | Cloning user repos and this repo |

Optional:

| Tool | Purpose | Check |
| --- | --- | --- |
| nixpacks | Automatic builds. If absent, the deploy engine falls back to a generated Dockerfile | `which nixpacks` |
| act | Run GitHub Actions workflows locally for CI testing | `act --version` |

The current machine has Node 24 and Docker 29, which satisfy all requirements.

Your user must be able to run Docker without sudo. If `docker ps` fails with a permission
error, add yourself to the docker group:

```bash
sudo usermod -aG docker "$USER"
# log out and back in (or run: newgrp docker) for it to take effect
```

---

## Local installation

### 1. Get the code

```bash
git clone <your-zonal-cloud-repo-url> zonal-cloud
cd zonal-cloud
```

If you already have the project at `/home/tinega/zonal-cloud`, just `cd` into it.

### 2. Configure environment

```bash
# Root infrastructure env (Traefik, PostgreSQL, Redis)
cp .env.example .env

# API env
cp apps/api/.env.example apps/api/.env

# Frontend envs
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/admin/.env.example apps/admin/.env
```

Then edit the files. At minimum set strong values for:

- Root `.env`: `POSTGRES_PASSWORD`, `JWT_SECRET`
- `apps/api/.env`: `JWT_SECRET`, `ENCRYPTION_KEY` (a 64-character hex string), and ensure
  `DATABASE_URL` matches the PostgreSQL credentials below.

Important: keep the database credentials consistent between the root `.env` (used by the
PostgreSQL container) and `apps/api/.env` (used by Prisma). For a local setup, use:

```
# root .env
POSTGRES_USER=zonal
POSTGRES_PASSWORD=changeme
POSTGRES_DB=zonal

# apps/api/.env  (the API runs on the host in dev, so it connects via localhost)
DATABASE_URL="postgresql://zonal:changeme@localhost:5432/zonal"
```

Generate a 64-character hex encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start infrastructure (PostgreSQL, Redis, Traefik)

```bash
docker compose up -d
docker compose ps
```

All four services (traefik, postgres, redis, whoami) should be running.

Verify the proxy is routing:

```bash
curl http://whoami.localhost
```

You should get request metadata back through Traefik. On most Linux systems `*.localhost`
resolves to `127.0.0.1` automatically. If it does not, add an entry to `/etc/hosts`:

```
127.0.0.1 whoami.localhost
```

### 4. Set up and run the API

```bash
cd apps/api
npm install
npm run prisma:generate
npm run prisma:migrate   # creates the schema in PostgreSQL
npm run dev              # API now listening on http://localhost:4000
```

Leave this running and open a new terminal for the frontends.

### 5. Run the dashboard and admin panel

```bash
# Terminal 2 - user dashboard
cd apps/dashboard
npm install
npm run dev      # http://localhost:5173

# Terminal 3 - admin panel
cd apps/admin
npm install
npm run dev      # http://localhost:5174
```

---

## Accessing the dashboard and admin panel

| Surface | URL | Who | Theme |
| --- | --- | --- | --- |
| User dashboard | http://localhost:5173 | Any registered user | Light/dark toggle in the top bar |
| Admin panel | http://localhost:5174 | Users with role admin or superadmin | Light/dark toggle in the top bar |
| Traefik dashboard | http://localhost:8080 | Operator (local only) | n/a |
| Deployed apps | http://&lt;app-slug&gt;.localhost | Public | n/a |

### Create the first account

1. Open the user dashboard at http://localhost:5173.
2. Register. The first registration creates an organization (tenant) and the first user.
3. Log in.

The very first registered user is created as a **superadmin**, which means the same
credentials also unlock the admin panel.

### Open the admin panel

1. Go to http://localhost:5174.
2. Log in with your superadmin (or admin) account.
3. A user without admin privileges sees an access-denied state here, by design.

From the admin panel you can manage all users and tenants, set per-tenant quotas, view and
stop any app across tenants, see platform metrics, and read the audit log.

### Theme toggle

Both apps default to your system light/dark preference and persist your choice in the browser
(`localStorage` key `zonal-theme`). Use the toggle in the top bar to switch.

---

## VPS installation (Ubuntu)

The platform runs on a VPS exactly as it does locally, with three differences: a real domain,
TLS via Let's Encrypt, and the services locked down. These steps assume Ubuntu 22.04 or 24.04.

### 1. Install prerequisites

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"     # log out/in afterwards

# Node.js 20+ (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 2. Point DNS at the server

In your DNS provider, create records pointing at the server's public IP:

```
A     @              <server-ip>      # yourdomain.com (optional, for the API/dashboard)
A     *.yourdomain.com   <server-ip>  # wildcard, so every app slug resolves
```

The wildcard record is what lets `<app-slug>.yourdomain.com` work without per-app DNS changes.

### 3. Get the code and configure

```bash
git clone <your-zonal-cloud-repo-url> zonal-cloud
cd zonal-cloud
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Edit `.env`:

- Set a strong `POSTGRES_PASSWORD` and `JWT_SECRET`.
- Set `DOMAIN=yourdomain.com` (uncomment it).

Edit `apps/api/.env`:

- Set `BASE_DOMAIN=yourdomain.com`.
- Set a strong `JWT_SECRET` and a real `ENCRYPTION_KEY`.
- Set `DATABASE_URL` to match your PostgreSQL credentials. When the API runs on the host,
  use `localhost`; when run as a container on `zonal_net`, use the host `postgres`.

### 4. Enable TLS in Traefik

Open `services/proxy/traefik.yml` and `docker-compose.yml` and switch from local to VPS mode
(the VPS lines are present but commented):

- Uncomment the `websecure` entrypoint on `:443` and expose `443:443` in compose.
- Uncomment the `certificatesResolvers.letsencrypt` block and set a real contact email.
- Uncomment the HTTP-to-HTTPS redirect.
- Set the Traefik API `insecure: false` (do not expose the dashboard publicly).
- For app routers, change the host rule from `*.localhost` to `*.yourdomain.com` and add
  `tls=true` with `tls.certresolver=letsencrypt`.

See `services/proxy/README.md` for the exact lines.

### 5. Bring it up

```bash
docker compose up -d

cd apps/api
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run start            # or run under a process manager / systemd
```

Build the frontends for production and serve the static output (through Traefik or any static
host):

```bash
cd ../dashboard && npm install && npm run build   # output in dist/
cd ../admin && npm install && npm run build        # output in dist/
```

Point a Traefik router at each `dist/` (or serve them with a small nginx container on
`zonal_net`). The dashboard and admin panel are then reachable over HTTPS on your domain.

### 6. Hardening checklist (VPS)

- Run the API under systemd or a process manager so it restarts on failure and on reboot.
- Do not expose the Traefik dashboard (port 8080) publicly.
- Restrict the firewall to ports 80, 443, and SSH.
- Back up the PostgreSQL volume on a schedule.
- Keep `JWT_SECRET` and `ENCRYPTION_KEY` secret and stable (rotating `ENCRYPTION_KEY`
  invalidates stored encrypted env vars).

---

## GitHub Actions auto-deploy

Push to a repo and have it deploy to Zonal automatically. The workflow calls the Zonal deploy
API with a per-app deploy token.

For local testing (no public URL yet), the workflow is run on this machine with `act`, which
executes the workflow in Docker against your local API. See `ci/README.md` for the full
procedure. In short:

1. In the dashboard, create a deploy token for an app.
2. Store it for `act` in a `.secrets` file (a `.secrets.example` is provided).
3. Run `act push` with the provided `ci/.actrc`.

The same `.github/workflows/deploy.yml` works unchanged on real GitHub Actions once the VPS is
live; only the API base URL and where the secret lives change.

---

## Environment variables

### Root `.env` (infrastructure)

| Variable | Example | Description |
| --- | --- | --- |
| `POSTGRES_USER` | `zonal` | PostgreSQL user created in the container |
| `POSTGRES_PASSWORD` | `changeme` | PostgreSQL password (set a strong one) |
| `POSTGRES_DB` | `zonal` | Database name |
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | Redis location on `zonal_net` |
| `JWT_SECRET` | long random string | Shared JWT signing secret |
| `DOMAIN` | `yourdomain.com` | VPS only; your real domain |

### `apps/api/.env` (API)

| Variable | Example | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://zonal:changeme@localhost:5432/zonal` | Prisma connection string |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis for BullMQ |
| `JWT_SECRET` | long random string | Must match the value the API signs/verifies with |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `ENCRYPTION_KEY` | 64-char hex | Encrypts stored env-var values (AES-256-GCM) |
| `BASE_DOMAIN` | `localhost` | App routing domain (`yourdomain.com` on VPS) |
| `DOCKER_NETWORK` | `zonal_net` | Network deployed app containers join |
| `NODE_ENV` | `development` | Node environment |

### `apps/dashboard/.env` and `apps/admin/.env`

| Variable | Example | Description |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Base URL of the API |

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `docker ps` permission denied | Add your user to the docker group (see Prerequisites), then re-login |
| `whoami.localhost` does not resolve | Add `127.0.0.1 whoami.localhost` to `/etc/hosts` |
| API cannot connect to the database | Ensure `docker compose up -d` ran, and `DATABASE_URL` host is `localhost` when the API runs on the host |
| Prisma migrate fails | The PostgreSQL container must be running and credentials in `apps/api/.env` must match the root `.env` |
| Build logs never appear in the UI | The API must be running; the dashboard streams logs over SSE from the API |
| Admin panel shows access denied | The account is not admin/superadmin; the first registered user is superadmin |
| A deployed app is unreachable | Check it is on `zonal_net` with the correct Traefik labels; inspect the Traefik dashboard at `http://localhost:8080` |

---

## Project layout

```
zonal-cloud/
  apps/
    api/         NestJS control plane (auth, apps, deploys, admin, deploy engine)
    dashboard/   User-facing React app
    admin/       Operator React app
  services/
    proxy/       Traefik configuration and routing docs
  ci/            GitHub Actions deploy workflow and act setup
  packages/
    shared/      Shared TypeScript types (the API contract)
  docker-compose.yml   Traefik, PostgreSQL, Redis, and a whoami test service
  SPEC.md        The build specification all components conform to
  docs/          Architecture and planning documents
```
