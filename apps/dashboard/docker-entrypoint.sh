#!/bin/sh
# Generate runtime config for the SPA from environment variables.
# Runs automatically via the stock nginx image's /docker-entrypoint.d/ hook.
#
# ZONAL_API_URL — the public API base the browser should call
#                 (e.g. https://api.example.com). If unset, the app falls back
#                 to its build-time / localhost default.
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.js"
API_URL="${ZONAL_API_URL:-}"

cat > "$CONFIG_PATH" <<EOF
window.__ZONAL_CONFIG__ = { apiUrl: "${API_URL}" };
EOF

echo "zonal: wrote ${CONFIG_PATH} (apiUrl=${API_URL:-<unset>})"
