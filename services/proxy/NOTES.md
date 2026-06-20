# Proxy agent judgment calls — items not covered by SPEC.md

## 1. Whoami test service in docker-compose.yml

SPEC does not mention a test service, but the task brief requires one to validate
the routing contract. I added `traefik/whoami` as a named service in
`docker-compose.yml` with the canonical labels for `whoami.localhost`. The README
documents how to use it for smoke testing. The backend agent can remove it or
leave it — it has no effect on app routing.

## 2. `traefik.http.routers.<slug>.entrypoints=web` label

SPEC section 6 lists exactly three labels:

```
traefik.enable=true
traefik.http.routers.<slug>.rule=Host(`<slug>.localhost`)
traefik.http.services.<slug>.loadbalancer.server.port=<containerPort>
```

An explicit `entrypoints` label is not listed. I did NOT add it to the SPEC-mandated
three labels because (a) `web` is the only entrypoint defined in `traefik.yml`, so
Traefik defaults to it, and (b) adding an undocumented fourth label would deviate
from the SPEC contract. The README notes that the label can be added for
explicitness without breaking anything.

In the whoami test service and the compose stubs I did include
`traefik.http.routers.whoami.entrypoints=web` explicitly because those are not
SPEC-mandated labels — they are examples, and being explicit aids understanding.

## 3. Redis AOF persistence enabled

SPEC does not specify Redis persistence mode. I enabled append-only file (AOF)
persistence (`redis-server --appendonly yes`) as the conservative default. BullMQ
queues survive a Redis restart this way, which prevents silent job loss during
development. This can be disabled for pure ephemeral caching use cases by removing
the `command` line from the redis service.

## 4. Postgres healthcheck and `depends_on` in compose stubs

SPEC does not require healthchecks. I added `pg_isready` and `redis-cli ping`
healthchecks, and wired the commented API stub to `depends_on` with
`condition: service_healthy`. This is standard practice and prevents the API from
crashing on startup because the database is not yet ready.

## 5. `exposedByDefault: false` on the Docker provider

SPEC requires opt-in via `traefik.enable=true`. Setting `exposedByDefault: false`
enforces this at the provider level, so any container that accidentally omits the
label is never routed. This matches SPEC section 6 intent.

## 6. Traefik container has `traefik.enable=false`

Traefik is on `zonal_net` (it needs network visibility to reach app containers).
Without `traefik.enable=false` on the Traefik container itself it would attempt
to route itself (no-op in practice, but confusing in the dashboard). Explicitly
disabling it keeps the dashboard clean.

## 7. `version: "3.9"` in docker-compose.yml

Docker Compose v2 ignores the `version` field but it aids readability and backward
compatibility with tools that inspect it. The value 3.9 is the latest v3 schema.

## 8. DATABASE_URL variable interpolation in .env.example

`.env.example` uses `${VAR}` interpolation in the `DATABASE_URL` line for
documentation clarity. Most shells expand these when sourcing the file, but
dotenv libraries read the literal string. The backend agent should either
set `DATABASE_URL` as a flat string in `.env` or ensure their dotenv library
handles interpolation. I documented both the expanded and unexpanded forms.

## 9. No dynamic config file provider in this pass

SPEC does not require a `dynamic/` directory for Traefik. All routing is via
Docker labels. I stubbed the file provider in `traefik.yml` as a comment for
future use (e.g., adding global middlewares like rate limiting or auth bypass
for health endpoints) without activating it.
