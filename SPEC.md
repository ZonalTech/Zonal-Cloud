# Zonal Cloud — Shared Build Spec (Single Source of Truth)

> Every agent MUST read this file fully before writing code and MUST conform to it.
> Do not invent structure, names, ports, or contracts that contradict this file.
> If something is unspecified, pick the simplest option consistent with this spec and note it in a `NOTES.md` in your own area — do NOT change shared contracts.

## 0. What we are building (this pass only)

A **Step 1 vertical slice** of Zonal Cloud, a self-hosted multi-tenant PaaS. The slice proves the
core loop end to end for ONE app type (static React/Vite):

`Git URL or zip -> backend deploy endpoint -> Nixpacks build (static) -> container -> Traefik routes app.<slug>.localhost`

Plus: a user dashboard and an admin panel (multi-tenant control), and a GitHub Actions
`deploy.yml` tested locally with `act`.

Do NOT build the other app types (node/fullstack/nodered) in this pass. Stub where needed.

## 1. Hard rules (apply to ALL agents)

- **No emojis** anywhere — not in code, comments, UI text, commit messages, logs, or docs.
- **Dark + light theme with a toggle** is mandatory in BOTH frontends (dashboard and admin).
  Default to system preference; persist the user's choice in localStorage.
- TypeScript everywhere (backend and frontends).
- Node v24, Docker 29 are available. Postgres + Redis + Traefik run via docker-compose.
- Keep secrets out of code. Use `.env` + `.env.example`.
- Stay inside your assigned directory. Do not edit other agents' directories or this SPEC.
- Match the API contract in section 4 EXACTLY. It is the integration boundary.

## 2. Monorepo layout (fixed)

```
zonal-cloud/
  apps/
    api/         # Backend agent — NestJS API, Prisma, BullMQ, deploy engine
    dashboard/   # Frontend agent — React+Vite+Tailwind, user-facing
    admin/       # Frontend agent — React+Vite+Tailwind, operator/admin panel
  services/
    proxy/       # Proxy agent — Traefik config + how app containers are labeled
  ci/            # CI agent — deploy.yml, act usage, deploy-token flow docs
  packages/
    shared/      # Shared TS types (the API contract types live here)
  docker-compose.yml   # Proxy agent owns this (Traefik+Postgres+Redis); api may extend
```

## 3. Data model (Prisma — backend agent owns the schema)

```
Org        id, name, slug, plan(free|pro), status(active|suspended), createdAt
User       id, orgId, email, passwordHash, role(user|admin|superadmin),
           status(active|suspended), createdAt
Quota      id, orgId, maxApps, cpu, memory, disk, buildMinutes, maxConcurrentDeploys
Project    id, orgId, userId, name, slug
App        id, projectId, name, type(static|node|fullstack|nodered),
           source(git|upload), repoUrl, branch, subdomain, buildCmd, outputDir, status
Deployment id, appId, ref, status(queued|building|live|failed), imageRef, logsRef, createdAt
EnvVar     id, appId, key, value(encrypted), isSecret
DeployToken id, appId, name, hashedToken, lastUsedAt
AuditLog   id, actorUserId, action, target, metadata, ip, createdAt
```

This pass: implement Org, User, Quota, Project, App, Deployment, DeployToken, AuditLog.
Only `type=static` is functional.

## 4. API contract (THE integration boundary — do not deviate)

Base URL: `http://localhost:4000`  | Prefix: `/v1` | Auth: `Authorization: Bearer <jwt>`
Deploy token auth (for CI): `Authorization: Bearer <deploy_token>` on the deploy route only.

All responses JSON. Errors: `{ "error": { "code": string, "message": string } }`.

Auth:
- `POST /v1/auth/register` { email, password, orgName } -> { token, user }
- `POST /v1/auth/login`    { email, password } -> { token, user }
- `GET  /v1/auth/me` -> { user }

Apps (user-scoped, JWT):
- `GET  /v1/apps` -> { apps: App[] }
- `POST /v1/apps` { name, source:"git"|"upload", repoUrl?, branch? } -> { app }
- `GET  /v1/apps/:id` -> { app, deployments: Deployment[] }
- `POST /v1/apps/:id/deploy` { ref? } -> { deployment }      # also accepts deploy-token auth
- `GET  /v1/apps/:id/logs` (SSE stream) -> text/event-stream of build+run logs
- `POST /v1/apps/:id/stop` -> { app }

Deploy tokens (JWT):
- `POST /v1/apps/:id/tokens` { name } -> { token }   # returns plaintext ONCE
- `GET  /v1/apps/:id/tokens` -> { tokens: {id,name,lastUsedAt}[] }

Admin (role admin|superadmin only, JWT + RBAC):
- `GET  /v1/admin/users` -> { users: User[] }            # all tenants
- `POST /v1/admin/users/:id/suspend` -> { user }
- `POST /v1/admin/users/:id/role` { role } -> { user }
- `GET  /v1/admin/orgs` -> { orgs: Org[] }
- `POST /v1/admin/orgs/:id/quota` { ...quota } -> { quota }
- `GET  /v1/admin/apps` -> { apps: App[] }               # all tenants
- `POST /v1/admin/apps/:id/stop` -> { app }
- `GET  /v1/admin/metrics` -> { users, orgs, apps, deployments, queueDepth }
- `GET  /v1/admin/audit` -> { logs: AuditLog[] }

Shared TS types for all of the above live in `packages/shared/src/types.ts`.
The backend agent authors these types; frontends import them.

## 5. Ports (fixed)

- API: 4000
- Dashboard (dev): 5173
- Admin (dev): 5174
- Traefik: 80 (entry) + 8080 (dashboard)
- Postgres: 5432, Redis: 6379
- Deployed apps: dynamic internal ports, exposed only via Traefik at `<slug>.localhost`

## 6. Routing contract (proxy agent + backend agent must agree)

When the backend runs a deployed app container, it attaches these Docker labels so Traefik routes it:
```
traefik.enable=true
traefik.http.routers.<slug>.rule=Host(`<slug>.localhost`)
traefik.http.services.<slug>.loadbalancer.server.port=<containerPort>
```
All app containers join the docker network named `zonal_net`.
Traefik watches the Docker provider on `zonal_net`.

## 7. Theme contract (frontend agent)

- A `ThemeProvider` with `theme: "light"|"dark"`, default = system (`prefers-color-scheme`),
  override persisted in `localStorage` key `zonal-theme`.
- A visible toggle in the top bar of both dashboard and admin.
- Use Tailwind `darkMode: "class"`; toggle adds/removes `dark` on `<html>`.
- Provide a small neutral token palette (no emojis, no decorative icons required).

## 8. Coordinator notes

The human's orchestrator (me) assigns tasks and re-states this spec to each agent to prevent
drift. If you are an agent and your task prompt conflicts with this spec, FOLLOW THIS SPEC and
flag the conflict in your final report.
