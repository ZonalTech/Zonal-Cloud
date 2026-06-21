# Zonal Cloud Dashboard — production image (static SPA served by nginx).
#
# This image is RUNTIME-configurable: the API URL is NOT baked at build time.
# At container start, docker-entrypoint.sh writes /usr/share/nginx/html/config.js
# from the ZONAL_API_URL env var, exposing window.__ZONAL_CONFIG__.apiUrl to the
# app. That lets ONE published image serve any domain (set by zonalctl / the
# operator), so CI can build a single generic image and push it to a registry.

# ---------- build stage ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-zonal-config.sh
RUN chmod +x /docker-entrypoint.d/40-zonal-config.sh
EXPOSE 80
# The stock nginx image runs scripts in /docker-entrypoint.d/ before starting,
# so we don't override CMD/ENTRYPOINT.
