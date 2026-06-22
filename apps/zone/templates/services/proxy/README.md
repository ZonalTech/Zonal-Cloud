# Zonal Cloud Proxy — Traefik v3

This directory contains the Traefik static configuration for Zonal Cloud.
The root `docker-compose.yml` (also owned by this agent) brings up Traefik,
Postgres, Redis, and the shared network `zonal_net`.

---

## How routing works

Traefik is configured with the **Docker provider** (`traefik.yml`).  
It watches the Docker socket for containers that:

1. Are attached to the network named `zonal_net`.
2. Have the label `traefik.enable=true`.

When those conditions are met, Traefik reads further labels from the container
to build a router (matching rule) and a service (upstream address). No static
config files need to change when new app containers are started — labels on the
container are the entire routing config.

Traffic flow:

```
Browser -> :80 (Traefik entrypoint "web")
        -> Router match: Host(`<slug>.localhost`)
        -> Service: container internal IP : containerPort
```

The Traefik dashboard (read-only, no auth in local mode) is at:
`http://localhost:8080`

---

## Labels the backend agent MUST put on every app container

These labels are the routing contract defined in SPEC section 6.
The backend agent MUST apply all three when it starts a deployed app container.
Replace `<slug>` with the app's subdomain slug and `<containerPort>` with the
port the app process listens on inside the container.

```
traefik.enable=true
traefik.http.routers.<slug>.rule=Host(`<slug>.localhost`)
traefik.http.services.<slug>.loadbalancer.server.port=<containerPort>
```

The container must also be attached to the `zonal_net` Docker network.

Example (Docker SDK / programmatic equivalent of docker run):

```
docker run -d \
  --name my-app-abc123 \
  --network zonal_net \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.my-app-abc123.rule=Host(\`my-app-abc123.localhost\`)" \
  --label "traefik.http.services.my-app-abc123.loadbalancer.server.port=3000" \
  my-app-image:latest
```

After the container starts, Traefik detects it within seconds (Docker provider
watches in real time) and the app becomes reachable at:
`http://my-app-abc123.localhost`

Note on entrypoint: the label `traefik.http.routers.<slug>.entrypoints=web` is
optional in this setup because `web` is the only entrypoint and Traefik defaults
to it. It can be added for explicitness without harm.

---

## How to verify routing with the whoami test container

The `whoami` service in `docker-compose.yml` is wired with the correct labels
for `whoami.localhost`. It serves as an end-to-end smoke test.

Steps:

1. Start the stack:

   ```
   cp .env.example .env
   docker compose up -d
   ```

2. Confirm all containers are healthy:

   ```
   docker compose ps
   ```

3. Resolve `whoami.localhost` to `127.0.0.1`. On Linux, `curl` resolves
   `*.localhost` to `127.0.0.1` automatically per RFC 6761, so this usually
   works directly. If not, add to `/etc/hosts`:

   ```
   127.0.0.1  whoami.localhost
   ```

4. Test routing:

   ```
   curl http://whoami.localhost
   ```

   Expected: JSON/text output from traefik/whoami showing request headers,
   IP, and hostname. This confirms Traefik received the request on port 80
   and forwarded it to the whoami container.

5. Open the Traefik dashboard to inspect routers and services:

   ```
   http://localhost:8080
   ```

---

## Local vs VPS differences

### Local (current)

- HTTP only, no TLS.
- Routes use `*.localhost` hostnames.
- Traefik dashboard is exposed insecure on port 8080 with no auth.
- `*.localhost` resolves to `127.0.0.1` on most systems without `/etc/hosts` changes.

### VPS (future — one-flag switch)

The required changes are all commented out in `traefik.yml` and
`docker-compose.yml`. To enable VPS mode:

1. In `traefik.yml`:
   - Uncomment the `websecure` entrypoint on `:443`.
   - Uncomment the `certificatesResolvers.letsencrypt` block and set your email.
   - Uncomment the HTTP-to-HTTPS redirect on the `web` entrypoint.
   - Set `api.insecure: false` and expose the dashboard only via a labelled router
     with a BasicAuth or IP-whitelist middleware.

2. In `docker-compose.yml`:
   - Uncomment port `443:443` on the traefik service.
   - Uncomment the `letsencrypt` named volume.
   - Mount the letsencrypt volume into the traefik container.

3. On each app router label, add:

   ```
   traefik.http.routers.<slug>.entrypoints=websecure
   traefik.http.routers.<slug>.tls=true
   traefik.http.routers.<slug>.tls.certresolver=letsencrypt
   ```

   And change the Host rule from `*.localhost` to `*.<yourdomain.com>`.

4. Set `DOMAIN=yourdomain.com` in `.env` and update `.env.example`.

---

## File inventory

| File | Purpose |
|---|---|
| `traefik.yml` | Traefik static config (entrypoints, providers, logging, ACME stubs) |
| `README.md` | This file |
| `NOTES.md` | Judgment calls not covered by the SPEC |
| `../../docker-compose.yml` | Infrastructure services (Traefik, Postgres, Redis, whoami test) |
| `../../.env.example` | Environment variable template |
