# Zonal Cloud API

NestJS + TypeScript backend for the Zonal Cloud PaaS platform.

## Requirements

- Node v24
- PostgreSQL (port 5432)
- Redis (port 6379)
- Docker (socket at /var/run/docker.sock)

## Setup

```bash
cp .env.example .env
# edit .env with your values

npm install
npm run prisma:migrate
npm run dev
```

The API starts on http://localhost:4000 with global prefix `/v1`.

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start with watch mode |
| `npm run build` | Compile to dist/ |
| `npm run start` | Run compiled output |
| `npm run prisma:migrate` | Run Prisma migrations |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:studio` | Open Prisma Studio |

## API Overview

See `/home/tinega/zonal-cloud/SPEC.md` section 4 for the full contract.

### Auth
- `POST /v1/auth/register` — create org + superadmin user
- `POST /v1/auth/login` — returns JWT
- `GET /v1/auth/me` — current user (JWT required)

### Apps
- `GET /v1/apps` — list apps in org
- `POST /v1/apps` — create app
- `GET /v1/apps/:id` — get app + deployments
- `POST /v1/apps/:id/deploy` — trigger deploy (JWT or deploy token)
- `GET /v1/apps/:id/logs` — SSE stream of latest deployment logs
- `POST /v1/apps/:id/stop` — stop running container

### Deploy tokens
- `POST /v1/apps/:id/tokens` — create token (plaintext returned once)
- `GET /v1/apps/:id/tokens` — list tokens (no plaintext)

### Admin (role admin|superadmin)
- `GET /v1/admin/users`
- `POST /v1/admin/users/:id/suspend`
- `POST /v1/admin/users/:id/role`
- `GET /v1/admin/orgs`
- `POST /v1/admin/orgs/:id/quota`
- `GET /v1/admin/apps`
- `POST /v1/admin/apps/:id/stop`
- `GET /v1/admin/metrics`
- `GET /v1/admin/audit`

## Deploy flow

1. Client calls `POST /v1/apps/:id/deploy`.
2. A `Deployment` row is created with status `queued`.
3. A BullMQ job is enqueued on the `deploy` queue (Redis).
4. The `DeployProcessor` worker:
   - Clones the git repo (or accepts an uploaded tarball).
   - Tries `nixpacks build`; if not available, generates a Dockerfile and runs `docker build`.
   - Stops the old container if running.
   - Creates a new Docker container on network `zonal_net` with Traefik labels.
   - Streams logs to Redis (keyed by deploymentId).
   - Updates `Deployment.status` to `live` or `failed`.

## SSE logs

`GET /v1/apps/:id/logs` returns `text/event-stream`. It reads the latest
deployment's logs from Redis and streams them. While the deployment is still
building it polls for new log lines.

## Environment variables

See `.env.example` for all required variables.
