# Backend agent judgment calls

## Data model

- `App.type` is constrained to `static|node|fullstack|nodered` per spec but only `static` is
  functionally implemented in this pass. Other types are stored but the deploy processor treats
  all apps as static builds (Nixpacks or nginx fallback Dockerfile). This matches the spec
  note: "Only type=static is functional."

- `App.status` enum is `idle|building|live|failed|stopped`. The spec lists only the Deployment
  status enum; `AppStatus` was inferred from the logical state transitions of an app.

- `EnvVar.value` is stored encrypted (AES-256-GCM) using the `ENCRYPTION_KEY` env var. The
  key must be a 64-character hex string (32 bytes). An all-zero default is used for development
  only — production must override this.

## Authentication

- `POST /v1/auth/register` creates an Org, a default Quota, and the first User with role
  `superadmin`. This matches the spec wording "creates Org + User (superadmin role)".

- The JWT payload includes `{ sub, email, role, orgId }`. The `role` claim is used by
  `RolesGuard` without a database roundtrip on every admin request (acceptable tradeoff for
  this pass; role changes take effect on next login).

- The deploy endpoint (`POST /v1/apps/:id/deploy`) uses a custom `DeployTokenGuard` that first
  tries JWT validation and falls back to scanning `DeployToken` rows for a bcrypt match.
  This avoids needing a second Passport strategy while keeping both auth paths on one route.

## Deploy engine

- Build temp directories are created at `/tmp/zonal-build-<deploymentId>` and cleaned up
  after a successful build. On failure the directory is left for debugging.

- The Nixpacks fallback Dockerfile targets `node:20-alpine` for build and `nginx:alpine` for
  serving. It assumes `npm install && npm run build` as the build command and `dist/` as the
  output directory unless the app row specifies otherwise.

- Container names are `zonal-<subdomain>` and must be unique per subdomain. Before starting a
  new container the processor stops and removes any existing container with that name.

- The SSE log stream polls Redis every 500 ms for up to 60 seconds (120 iterations). After 5
  iterations with no new lines and the Redis key gone, the stream closes. This is intentionally
  simple for Step 1; a pub/sub approach would be cleaner at scale.

## Shared types

- `packages/shared/src/types.ts` exports TypeScript interfaces for all entities and
  request/response shapes. The `User` interface omits `passwordHash` as the spec requires.
  `EnvVar` also omits the encrypted `value` field from the public interface.

## Module structure choices

- `PrismaModule` is `@Global()` so it does not need to be imported in every feature module.
- `DeployModule` exports `DeployService` and `LogStoreService` so both `AppsModule` and
  `AdminModule` can use them without circular imports.
- `AuditService` is provided locally in each module that needs it rather than being global,
  keeping the dependency graph explicit.

## App project model

- The spec defines `Project` as an intermediate between `Org` and `App`. The `CreateApp`
  endpoint accepts an optional `projectId`; if not supplied, a default project is auto-created
  for the user in their org. This keeps the API simple for single-project users while allowing
  multi-project organizations.

## ConfigModule

- `@nestjs/config` (`ConfigModule`) was added to the dependency list and is used throughout the
  codebase. It is not listed in the spec's package.json hint but is a standard NestJS pattern
  and necessary for environment variable injection.
