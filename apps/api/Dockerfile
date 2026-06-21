# Zonal Cloud API — production image.
#
# Multi-stage: install + build with the full toolchain, then ship a slim
# runtime that contains only production deps and the compiled dist/.
#
# Notes:
#  - The API talks to the Docker daemon via /var/run/docker.sock (dockerode),
#    so the container must run with that socket mounted (see docker-compose.prod.yml).
#  - PRISMA_ENGINES_MIRROR points at npmmirror because the default Prisma CDN
#    is heavily throttled on some networks (documented in the repo README).
#  - prisma generate runs at build time so the query engine is baked in.

# ---------- build stage ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

ENV PRISMA_ENGINES_MIRROR=https://cdn.npmmirror.com/binaries/prisma

# OpenSSL is needed by Prisma's engine at build time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# The operator scripts (e.g. create-superadmin) are excluded from nest build,
# so compile them separately into dist/scripts for the runtime image. They are
# CommonJS and share the same compiler options as the app.
RUN npx tsc scripts/create-superadmin.ts \
      --outDir dist/scripts \
      --module commonjs --target ES2021 --esModuleInterop --skipLibCheck

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY package.json ./

EXPOSE 4000

# Compiled entrypoint (apps/api/src/main.ts -> dist/main.js).
CMD ["node", "dist/main.js"]
