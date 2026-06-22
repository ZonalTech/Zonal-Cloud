# Zonal Cloud

A self-hosted, multi-tenant Platform-as-a-Service for full-stack web deployment. It builds
and runs static frontends, Node.js backends, full-stack apps, and Node-RED instances in
Docker, with a reverse proxy that gives every app its own URL. It runs the same way on a
local machine and on an Ubuntu VPS.

This document covers installation (local and VPS), prerequisites, how to access the
dashboard and the admin panel, and the database setup.

> 📘 **Going to production?** See
> [`docs/DEPLOYMENT_AND_TROUBLESHOOTING.md`](docs/DEPLOYMENT_AND_TROUBLESHOOTING.md)
> — an end-to-end runbook (publish images → install → domain + HTTPS → deploy apps)
> with a catalogue of real errors and their fixes.

> Status: in active development. Static and Node/full-stack apps deploy end to end from a Git
> repo or a connected GitHub account (push-to-deploy). Full-stack apps are automatically given
> a managed PostgreSQL database inside the shared server. App types: `static`, `node`,
> `fullstack`, `nodered`.
>
> Two install paths are documented below: the **`zone` operator CLI** (recommended for servers —
> installs from npm and pulls prebuilt images, no monorepo clone) and a **manual from-source**
> setup (recommended for local development on this repo).

### What has been verified

The steps below were exercised on a development machine. Verified working:

- `npm install` for the API, dashboard, and admin
- TypeScript builds: `tsc` (dashboard, admin) and `nest build` (API) all compile cleanly
- Dashboard dev server boots and serves on http://localhost:5173
- Admin dev server boots and serves on http://localhost:5174
- API compiles and the NestJS bootstrap runs

Requires a working environment to complete (documented in the steps):

- Docker Engine reachable by your user, plus the Docker Compose plugin (for PostgreSQL,
  Redis, and Traefik)
- Outbound access to a Prisma engine source on first `prisma generate`. Prisma's default CDN
  (`binaries.prisma.sh`) is slow on many networks; the steps below use the faster
  `cdn.npmmirror.com` mirror via `PRISMA_ENGINES_MIRROR`. This is an environment/network
  detail, not a code issue.

---

## Quickstart: see the dashboard

Every command, in order, to get the dashboard open in your browser. Run from the repo root.
Each numbered block is a separate terminal that stays running.

```bash
# ---------------------------------------------------------------
# 0. One-time setup (skip if `docker ps` and `docker compose version` already work)
# ---------------------------------------------------------------
sudo usermod -aG docker "$USER"
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
newgrp docker                                  # refresh group in this shell
docker ps && docker compose version            # both must succeed

# ---------------------------------------------------------------
# 1. Configure environment (from the repo root)
# ---------------------------------------------------------------
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/admin/.env.example apps/admin/.env

# Generate and inject the API encryption key (64-char hex)
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$KEY/" apps/api/.env

# ---------------------------------------------------------------
# 2. Start infrastructure: PostgreSQL, Redis, Traefik (background)
# ---------------------------------------------------------------
docker compose up -d
docker compose ps                              # traefik, postgres, redis, whoami = running
curl http://whoami.localhost                   # proves the proxy routes (request metadata)

# ---------------------------------------------------------------
# 3. API — Terminal 1 (leave running)
# ---------------------------------------------------------------
cd apps/api
npm install

# Prisma's default CDN (binaries.prisma.sh) is slow/throttled on many networks.
# Use the faster npmmirror mirror so the engine downloads in seconds. Export it
# for prisma:generate and prisma:migrate (safe to add to your shell profile).
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"

npm run prisma:generate                        # downloads engines from the mirror
npm run prisma:migrate                         # creates the database schema
npm run dev                                     # serves http://localhost:4000

# ---------------------------------------------------------------
# 4. Dashboard — Terminal 2 (leave running)
# ---------------------------------------------------------------
cd apps/dashboard
npm install
npm run dev                                     # serves http://localhost:5173

# ---------------------------------------------------------------
# 5. Admin panel — Terminal 3 (optional, leave running)
# ---------------------------------------------------------------
cd apps/admin
npm install
npm run dev                                     # serves http://localhost:5174
```

Then open the dashboard in your browser:

```
http://localhost:5173
```

Web registration always creates a regular **user**. The platform **superadmin** is created
only from the terminal — see Local installation, Step 9 (`npm run create-superadmin`). Log in
with the superadmin credentials to reach the admin panel at **http://localhost:5174**.

If you only want to look at the dashboard UI (no login, no deploys), you can run just step 4 —
the dashboard dev server starts on its own; API-backed actions will simply error until the API
in step 3 is running.

> Verified: steps 1, 4, and 5 run as shown (frontends serve HTTP 200). Steps 0, 2, and 3
> require Docker access and network access to `binaries.prisma.sh`; see Troubleshooting if
> either is restricted on your machine.

---

## Contents

- [Quickstart: see the dashboard](#quickstart-see-the-dashboard)
- [Architecture at a glance](#architecture-at-a-glance)
- [Database](#database)
- [Prerequisites](#prerequisites)
- [Install with the `zone` CLI (servers)](#install-with-the-zone-cli-servers)
- [Local installation (from source)](#local-installation-from-source)
- [Accessing the dashboard and admin panel](#accessing-the-dashboard-and-admin-panel)
- [GitHub integration (connect repos & push-to-deploy)](#github-integration-connect-repos--push-to-deploy)
- [Managed per-app databases (full-stack apps)](#managed-per-app-databases-full-stack-apps)
- [Notifications](#notifications)
- [VPS installation from source (Ubuntu)](#vps-installation-from-source-ubuntu)
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
| Reverse proxy | Traefik v3 | 8090 local / 80+443 VPS (8080 dashboard) | Routes each app at `<slug>.localhost` |
| Database | PostgreSQL 16 | 5432 | Platform data + managed per-app databases |
| Queue / cache | Redis 7 | 6379 | Build job queue and log buffering |
| Operator CLI | `@zonalcloud/zone` (npm) | n/a | Install/run/upgrade/backup the platform on a server |

Infrastructure (Traefik, PostgreSQL, Redis) runs via `docker-compose.yml`. The API and the
two frontends run as Node processes in development.

> Local proxy port: a system nginx commonly holds `:80`, so locally Traefik publishes its HTTP
> entrypoint on **`:8090`** and apps are reachable at `http://<slug>.localhost:8090`. This is
> controlled by `APP_HTTP_PORT` in `apps/api/.env`; set it to `""`/`80` once `:80` is free (and
> on the VPS, where Traefik owns `:80`/`:443`).

The platform now supports two deployment models:

- **From-source (this repo):** clone the monorepo, run the API + frontends. Best for local
  development. See [Local installation (from source)](#local-installation-from-source).
- **Prebuilt images via the `zone` CLI:** install a standalone CLI from npm that pulls
  published `api`/`dashboard`/`admin` images and runs them with Traefik + Postgres + Redis. The
  server never needs the monorepo. See [Install with the `zone` CLI](#install-with-the-zone-cli-servers).

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

The Docker daemon must be reachable by your user and the Compose plugin installed. The Local
installation steps below begin with that one-time setup (Step 1).

---

## Install with the `zone` CLI (servers)

`zone` (`@zonalcloud/zone`, in [`apps/zone/`](apps/zone/)) is a standalone operator CLI that
installs, runs, and maintains the platform on a Linux server **without cloning this repo**. It
carries its own copy of the deploy files and pulls **prebuilt** `api`/`dashboard`/`admin`
images from a container registry (GHCR by default).

```bash
# Install the CLI from npm — use the scoped name and -g (not `npm install zone`)
npm install -g @zonalcloud/zone
zone --version

# Or bootstrap Node + the CLI and install in one shot (scripts/install.sh):
curl -fsSL https://raw.githubusercontent.com/ZonalTech/Zonal-Cloud/main/scripts/install.sh \
  | bash -s -- --domain example.com --acme-email you@example.com
```

Typical server flow:

```bash
zone preflight      # read-only readiness check (OS, RAM, disk, Docker, ports)
zone install        # pull images, write deploy files + secrets, migrate, create superadmin
zone status         # confirm services are healthy
```

`install` is idempotent (existing `.env` secrets are preserved). With `--domain` it switches to
**production/TLS mode**: Traefik serves HTTPS on `:443`, redirects HTTP→HTTPS, and obtains
Let's Encrypt certificates for `api.`, `dashboard.`, and `admin.` + your domain (point DNS at
the server and open ports 80/443 first). Omit `--domain` for localhost/HTTP mode.

Other lifecycle commands: `up`/`down`/`restart`, `logs`, `migrate`, `superadmin`, `tls`,
`upgrade --tag vX.Y.Z`, `backup`, `restore`, `secrets rotate`. State (compose files,
`traefik.yml`, `.env`, `backups/`) lives in a data directory (`ZONAL_DATA_DIR`, else
`/opt/zonal-cloud`, else `~/.zonal-cloud`).

Images are published by the [`.github/workflows/release.yml`](.github/workflows/release.yml)
workflow. Full CLI reference: [`apps/zone/README.md`](apps/zone/README.md).

---

## Local installation (from source)

Use this path to develop on the monorepo. Follow these steps in order: the database must be
running before the API can migrate or start. Each step says which terminal it belongs in.

### Step 1 — One-time Docker setup

The API, database, Redis, and proxy all run in Docker. On a fresh machine two things usually
need fixing first. Run these once:

```bash
# a) Allow your user to use Docker without sudo
sudo usermod -aG docker "$USER"

# b) Install the Docker Compose v2 plugin
sudo apt-get update && sudo apt-get install -y docker-compose-plugin

# c) Apply the new group membership (or log out and back in)
newgrp docker
```

Confirm both work before continuing — neither command should error:

```bash
docker ps                 # must NOT say "permission denied"
docker compose version    # must print Compose v2.x
```

### Step 2 — Get the code

```bash
git clone <your-zonal-cloud-repo-url> zonal-cloud
cd zonal-cloud
```

If you already have the project, just `cd` into it. Run all remaining steps from this repo
root unless told otherwise.

### Step 3 — Create the environment files

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/admin/.env.example apps/admin/.env
```

### Step 4 — Set secrets and check the database credentials

Generate the API encryption key (a 64-character hex string) and write it in:

```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$KEY/" apps/api/.env
```

Then edit the files and set strong values for `JWT_SECRET` (in both `.env` and
`apps/api/.env`) and `POSTGRES_PASSWORD` (in root `.env`).

Important — the database credentials must match between the two files, or the API cannot
connect. The defaults already match; if you change the password, change it in both places:

```
# root .env  (used by the PostgreSQL container)
POSTGRES_USER=zonal
POSTGRES_PASSWORD=changeme
POSTGRES_DB=zonal

# apps/api/.env  (used by the API; it runs on the host in dev, so host is localhost)
DATABASE_URL="postgresql://zonal:changeme@localhost:5432/zonal"
```

### Step 5 — Start the database, Redis, and proxy

```bash
docker compose up -d
docker compose ps          # traefik, postgres, redis, whoami must all be "running"
```

If you already run a native Redis on port 6379, the Redis container will fail to bind that
port. That is harmless — start the others and let the API use your native Redis:

```bash
docker compose up -d postgres traefik whoami
```

Confirm PostgreSQL is actually accepting connections on port 5432 before moving on:

```bash
docker compose exec postgres pg_isready -U zonal    # expect: "accepting connections"
```

Verify the proxy routes (optional but quick):

```bash
curl http://whoami.localhost     # returns request metadata through Traefik
```

On most Linux systems `*.localhost` resolves to `127.0.0.1` automatically. If it does not, add
`127.0.0.1 whoami.localhost` to `/etc/hosts`.

### Step 6 — Set up and run the API (Terminal 1)

```bash
cd apps/api
npm install

# Prisma downloads its engines on first generate. Its default CDN
# (binaries.prisma.sh) is slow/throttled on many networks. Use the faster mirror:
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"

npm run prisma:generate    # downloads the Prisma engines from the mirror
npm run prisma:migrate     # creates the tables (PostgreSQL from step 5 must be running)
npm run dev                # API now listening on http://localhost:4000
```

Confirm the API is serving:

```bash
curl http://localhost:4000/v1/auth/me     # expect HTTP 401 (no token) — proves it is up
```

Leave the API running in this terminal.

Notes:

- Why the mirror: on a normal connection `binaries.prisma.sh` is fine and you can skip the
  export. On throttled networks it delivers the ~7 MB engine at a few KB/s, so
  `prisma generate` fails with `Error: request to https://binaries.prisma.sh/... failed,
  reason:` and the API then fails with `@prisma/client did not initialize yet`. The mirror
  serves the identical files far faster. Make it permanent by adding the `export` line to
  `~/.bashrc`.
- If you see `connect ECONNREFUSED 127.0.0.1:5432` when registering or starting the API, the
  database is not running — go back to step 5 (`docker compose up -d`).
- Resilience: Prisma is configured with the PostgreSQL driver adapter (`@prisma/adapter-pg`,
  the `driverAdapters` preview feature), so the client connects through the `pg` driver and
  the WASM query engine, reducing reliance on the native engine binary.

### Step 7 — Run the dashboard (Terminal 2)

```bash
cd apps/dashboard
npm install
npm run dev      # http://localhost:5173
```

### Step 8 — Run the admin panel (Terminal 3)

```bash
cd apps/admin
npm install
npm run dev      # http://localhost:5174
```

Each dev server prints `VITE vX ready` and serves immediately. If a port is taken, Vite picks
the next free one and prints the actual URL.

### Step 9 — Create the superadmin (CLI only)

The platform superadmin (the Administrator) is created **only from the terminal**, never
through the web UI. This is deliberate: web registration always creates a regular `user`, and
the superadmin role cannot be granted, changed, or suspended through the dashboard or admin API
(those actions return HTTP 403). The only way to make a superadmin is this CLI command, which
writes directly to the database.

From `apps/api` (the database from Step 5 must be running):

```bash
cd apps/api
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"   # if not already set
npm run create-superadmin -- admin@example.com 'ChangeThisStrongPass#1' 'Administrator'
#                              ^email             ^password                ^org name (optional)
```

- Email defaults to `admin@example.com` and org name to `Administrator` if omitted; a password
  is always required (minimum 8 characters).
- If the email already exists, the account is promoted to superadmin and its password updated.
- On success it prints `Superadmin created: admin@example.com ...`.

Log in with these credentials at the dashboard (http://localhost:5173) and the admin panel
(http://localhost:5174).

Promoting other people: a superadmin can promote a normal user to `admin` from the admin panel
(or `POST /v1/admin/users/:id/role`), but `superadmin` itself can only ever be granted by
re-running this CLI command.

Regular users still self-register in the dashboard:

```bash
curl -X POST http://localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-strong-password","orgName":"Your Org"}'
# -> always returns "role":"user"
```

---

## Accessing the dashboard and admin panel

| Surface | URL | Who | Theme |
| --- | --- | --- | --- |
| User dashboard | http://localhost:5173 | Any registered user | Light/dark toggle in the top bar |
| Admin panel | http://localhost:5174 | Users with role admin or superadmin | Light/dark toggle in the top bar |
| Traefik dashboard | http://localhost:8080 | Operator (local only) | n/a |
| Deployed apps | http://&lt;app-slug&gt;.localhost:8090 (local) / https on VPS | Public | n/a |

### Create the first account

There is no default login. Web registration always creates a regular `user`. The **superadmin**
is created only from the terminal with `npm run create-superadmin` (see Local installation,
Step 9), and its role cannot be changed or suspended through the UI. The superadmin's
credentials log into both the dashboard and the admin panel.

### Open the admin panel

1. Go to http://localhost:5174.
2. Log in with your superadmin (or admin) account.
3. A user without admin privileges sees an access-denied state here, by design.

From the admin panel you can manage all users and tenants, set per-tenant quotas, view and
stop any app across tenants, see platform metrics, and read the audit log.

### Theme toggle

Both apps default to your system light/dark preference and persist your choice in the browser
(`localStorage` key `zonal-theme`). Use the toggle in the top bar to switch.

### Forgot / reset password

The login page has a **Forgot password?** link. The flow:

1. Enter your email on `/forgot-password`. The API issues a one-time reset token (valid 1 hour).
2. You receive a reset link (see delivery below) and open it — it lands on `/reset-password`.
3. Set a new password and sign in.

How the link is delivered depends on whether SMTP is configured (in `apps/api/.env`):

- **No SMTP set (default, dev mode):** no email is sent. The reset link is returned in the
  `forgot-password` response and the request page shows a "Continue to reset your password"
  link directly. The link is also logged by the API. Good for local development.
- **SMTP set:** the link is emailed via Nodemailer. For a realistic local inbox, the bundled
  **Mailpit** service (in `docker-compose.yml`) is an open-source SMTP server with a web UI.
  Point the API at it and read captured emails in the browser:

  ```
  # apps/api/.env
  SMTP_HOST=localhost
  SMTP_PORT=1025
  SMTP_FROM=Zonal Cloud <no-reply@zonal.local>
  ```

  Then open the Mailpit inbox at **http://localhost:8025** to see the reset email.
  For production, set `SMTP_HOST/PORT/USER/PASS` to a real mail provider.

Security notes: reset tokens are stored hashed (SHA-256), are single-use, expire after one
hour, and `forgot-password` always returns the same generic message so it cannot be used to
discover which emails have accounts.

### AI deploy-log analyzer (admin)

The admin panel can explain failed deployments with AI. On the **Apps** page, a failed
app shows an **Explain with AI** button; clicking it sends the build log to a Mistral agent
and shows a plain-English diagnosis and suggested fix.

Configure it in `apps/api/.env`:

```
MISTRAL_API_KEY=...        # your Mistral API key
MISTRAL_AGENT_ID=...       # the agent id from https://console.mistral.ai
```

If either is blank the feature is disabled gracefully (the button is hidden and the API
returns a clear "not configured" message rather than erroring).

### AI agent over MCP (inspect / act on apps)

`packages/mcp` is an [MCP](https://modelcontextprotocol.io) server that lets an AI agent
inspect and act on deployed apps: `list_apps`, `get_app`, `list_deployments`, `get_metrics`,
`deploy_app`, `stop_app`. It authenticates to the Zonal API with a base URL + token.

Set those on the admin **Settings** page (the token is stored encrypted), then launch the
server with the same values:

```bash
cd packages/mcp
npm install && npm run build
ZONAL_API_URL=http://localhost:4000 ZONAL_AGENT_TOKEN=<superadmin-jwt> node dist/index.js
```

Point any MCP client (Claude, etc.) at it — see `packages/mcp/README.md` for the client
config. Action tools change platform state, so only give the token to a trusted agent.

**Permanent agent tokens.** Instead of a short-lived login JWT, generate a long-lived,
revocable token for the agent on the admin **Settings** page (under *Agent tokens*). These
tokens (`ztk_...`) are stored hashed, never expire, and the API accepts them as admin auth on
the routes the MCP tools use. Revoke one anytime — it stops working immediately.

**One-click MCP config.** On the Settings page, **Download MCP config** mints a fresh agent
token and downloads a ready-to-use `.mcp.json` (server path + base URL + token already filled
in). Drop it where your MCP client reads its config and the agent is wired with no manual env
setup.

### Custom domains

Every app is reachable at its default `<slug>.localhost`. You can also attach your own
domains (e.g. `app.yourdomain.com`) from the app's detail page in the dashboard.

The flow:

1. On the app page, under **Custom domains**, enter a domain and click **Add domain**. It
   starts as `pending` and the UI shows two DNS records to create:
   - a **TXT** record at `_zonal-challenge.<domain>` containing the verify token (proves you
     own the domain), and
   - a **CNAME** (or A) record pointing `<domain>` at the platform host.
2. Create those records at your DNS provider, then click **Verify**. The API resolves the TXT
   record; when it matches, the domain becomes `verified`.
3. **Redeploy the app** — verified domains are attached as Traefik routes at deploy time, so a
   new deployment makes the domain live.

TLS: set `ACME_RESOLVER` in `apps/api/.env` (matching the resolver in
`services/proxy/traefik.yml`) to issue Let's Encrypt certificates for custom domains. This is
for the VPS with public domains; locally, custom domains stay HTTP. A domain can only be
attached to one app (duplicates are rejected).

---

## GitHub integration (connect repos & push-to-deploy)

Beyond deploying from a public Git URL, a user can connect their **GitHub account** and deploy
straight from their repositories, with new commits auto-deploying.

The flow:

1. Configure GitHub OAuth on the server (see env vars below). Create an OAuth App at
   https://github.com/settings/developers with callback URL
   `http://localhost:4000/v1/github/callback` (use your public API origin in production).
2. In the dashboard, **Connect GitHub** (`GET /v1/github/authorize` → GitHub → `/v1/github/callback`).
   The connection (token, encrypted) is stored against the user.
3. When creating an app, pick a connected repo (`githubRepoFullName` = `owner/repo`). The API
   installs a push webhook on that repo.
4. Pushing to the repo hits `POST /v1/github/webhook/:appId`, which enqueues a deploy — commits
   ship automatically.

Disconnect anytime from the dashboard (`DELETE /v1/github/disconnect`). If GitHub OAuth is not
configured, the API returns a clear `GITHUB_NOT_CONFIGURED` error and the UI hides the feature.

Configure it in `apps/api/.env`:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_STATE_SECRET=...        # optional; falls back to JWT_SECRET
API_PUBLIC_URL=http://localhost:4000     # used to build callback + webhook URLs
DASHBOARD_URL=http://localhost:5173      # post-connect redirect target
```

---

## Managed per-app databases (full-stack apps)

When you deploy a **full-stack** app, the platform automatically provisions a dedicated
PostgreSQL database and a scoped role **inside the shared Postgres server**, and injects a
`DATABASE_URL` into the app container at deploy time. You do not create or wire up a database by
hand — the app gets one on its first deploy.

Key points:

- The per-app database is separate from the control-plane database; each app gets its own DB and
  least-privilege role.
- The connection string injected into the container uses the **`postgres` service host** on
  `zonal_net` (not `localhost`), because the app container talks to Postgres over the Docker
  network.
- A provisioning failure is fatal for that deploy (the app cannot run without its database).

Configure it in `apps/api/.env`:

```
# Admin DSN used to run CREATE ROLE/DATABASE (defaults to DATABASE_URL — the `zonal` superuser)
# APP_DB_ADMIN_URL="postgresql://zonal:changeme@localhost:5432/zonal"

# How the APP CONTAINER reaches Postgres (the compose service name, not localhost)
APP_DB_HOST=postgres
APP_DB_PORT=5432
```

---

## Notifications

The dashboard shows in-app notifications via a bell in the top bar. Two kinds are raised today:

- **Impersonation alert** — a user is told when an operator has impersonated their account.
- **Deployment-failure alert** — the app owner is notified when one of their deployments fails.

Endpoints: `GET /v1/notifications` (unread), `POST /v1/notifications/:id/read`,
`POST /v1/notifications/read-all`. On the admin side, deployment-failure notifications are
aggregated cross-tenant into an operator **Errors** view. Notifications carry structured
metadata (who impersonated, which deployment failed) for context.

---

## VPS installation from source (Ubuntu)

> For most servers, prefer the [`zone` CLI](#install-with-the-zone-cli-servers) — it pulls
> prebuilt images and needs no source on the box. The steps below are the manual, build-from-
> source alternative.

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
export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"   # faster engine download
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
| `ENCRYPTION_KEY` | 64-char hex | Encrypts stored env-var values & tokens (AES-256-GCM) |
| `BASE_DOMAIN` | `localhost` | App routing domain (`yourdomain.com` on VPS) |
| `APP_HTTP_PORT` | `8090` | Public port for Traefik's HTTP entrypoint locally; `""`/`80` on VPS |
| `APP_HTTP_SCHEME` | `http` | Scheme used to build deployed-app URLs |
| `DOCKER_NETWORK` | `zonal_net` | Network deployed app containers join |
| `APP_DB_HOST` / `APP_DB_PORT` | `postgres` / `5432` | How app containers reach the shared Postgres |
| `APP_DB_ADMIN_URL` | (defaults to `DATABASE_URL`) | Admin DSN for provisioning per-app databases |
| `ACME_RESOLVER` | (blank locally) | Traefik resolver name for custom-domain TLS (VPS) |
| `API_PUBLIC_URL` | `http://localhost:4000` | Public API origin (OAuth callback + webhook URLs) |
| `DASHBOARD_URL` | `http://localhost:5173` | Public dashboard origin (post-connect redirect) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Allowed CORS origins (dashboard + admin) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from GitHub OAuth App | GitHub connect + push-to-deploy (blank = disabled) |
| `GITHUB_STATE_SECRET` | random (or `JWT_SECRET`) | HMAC secret for the OAuth `state` param |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Password-reset email (blank host = dev mode) |
| `MISTRAL_API_KEY` / `MISTRAL_AGENT_ID` | from console.mistral.ai | AI deploy-log analyzer (blank = disabled) |
| `NODE_ENV` | `development` | Node environment |

See [`apps/api/.env.example`](apps/api/.env.example) for the authoritative, commented list.

### `apps/dashboard/.env` and `apps/admin/.env`

| Variable | Example | Description |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Base URL of the API |

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `docker ps` permission denied | Add your user to the docker group (see One-time Docker setup), then `newgrp docker` or re-login |
| `docker compose` is an unknown command | Install the Compose plugin: `sudo apt-get install -y docker-compose-plugin` |
| `prisma generate` fails with `Error: request to https://binaries.prisma.sh/... failed, reason:` | The Prisma CDN is slow/throttled on your network. Set the faster mirror and retry: `export PRISMA_ENGINES_MIRROR="https://cdn.npmmirror.com/binaries/prisma"` then `npm run prisma:generate`. Confirm success with `ls apps/api/node_modules/.prisma/client/*.node` |
| `@prisma/client did not initialize yet` on API start | `prisma generate` did not complete (usually the engine download above failed). Set `PRISMA_ENGINES_MIRROR` as shown, re-run `npm run prisma:generate`, then start the API again |
| `whoami.localhost` does not resolve | Add `127.0.0.1 whoami.localhost` to `/etc/hosts` |
| `docker compose up` fails: `failed to bind host port 0.0.0.0:6379: address already in use` | You already run a native Redis on 6379. That is fine — the API uses it. Start the other services only: `docker compose up -d postgres traefik whoami`, or stop the native Redis if you prefer the container |
| Traefik logs `client version 1.24 is too old. Minimum supported API version is 1.44` | The Traefik image predates your Docker Engine. Use `traefik:v3.5` (already set in docker-compose.yml) and recreate: `docker compose up -d --force-recreate traefik` |
| `failed to bind host port 0.0.0.0:80: address already in use` | Another process (often a host nginx/apache) holds port 80. Find it with `sudo ss -ltnp | grep ':80'` and stop it, or change Traefik's published port in docker-compose.yml (e.g. `8088:80`) and use `http://whoami.localhost:8088`. Routing of deployed apps needs port 80 free |
| API cannot connect to the database | Ensure `docker compose up -d` ran, and `DATABASE_URL` host is `localhost` when the API runs on the host |
| Prisma migrate fails | The PostgreSQL container must be running and credentials in `apps/api/.env` must match the root `.env` |
| Build logs never appear in the UI | The API must be running; the dashboard streams logs over SSE from the API |
| Admin panel shows access denied | The account is not admin/superadmin. Create a superadmin from the CLI: `cd apps/api && npm run create-superadmin -- admin@example.com 'pass'` (see Step 9) |
| A deployed app is unreachable | Check it is on `zonal_net` with the correct Traefik labels; inspect the Traefik dashboard at `http://localhost:8080` |

---

## Project layout

```
zonal-cloud/
  apps/
    api/         NestJS control plane (auth, apps, deploys, admin, deploy engine,
                 github, notifications, per-app database provisioning)
    dashboard/   User-facing React app
    admin/       Operator React app
    zone/        @zonalcloud/zone — standalone operator CLI (install/run/upgrade)
  services/
    proxy/       Traefik configuration and routing docs
  ci/            GitHub Actions deploy workflow and act setup
  scripts/
    install.sh   Bootstrap installer (Node + the zone CLI, then `zone install`)
  packages/
    shared/      Shared TypeScript types (the API contract)
    mcp/         MCP server for AI agents to inspect/act on apps
  .github/workflows/
    deploy.yml   Per-app push-to-deploy workflow
    release.yml  Builds & publishes the api/dashboard/admin images
  docker-compose.yml       Traefik, PostgreSQL, Redis, Mailpit, and a whoami test service
  docker-compose.vps.yml   VPS overlay (TLS / production routing)
  docker-compose.prod.yml  Prebuilt-image production stack
  SPEC.md        The build specification all components conform to
  docs/          Architecture and planning documents
```
