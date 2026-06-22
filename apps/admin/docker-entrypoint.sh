#!/bin/sh
# Generate runtime config for the SPA from environment variables.
# Runs automatically via the stock nginx image's /docker-entrypoint.d/ hook.
#
# ZONAL_API_URL       — the public API base the browser should call
#                       (e.g. https://api.example.com).
# ZONAL_DASHBOARD_URL — public URL of the user dashboard app, linked from the
#                       admin account menu (e.g. https://dashboard.example.com).
# Either unset → the app falls back to its build-time / localhost default.
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.js"
API_URL="${ZONAL_API_URL:-}"
DASHBOARD_URL="${ZONAL_DASHBOARD_URL:-}"
MAIL_URL="${ZONAL_MAIL_URL:-}"

cat > "$CONFIG_PATH" <<EOF
window.__ZONAL_CONFIG__ = { apiUrl: "${API_URL}", dashboardUrl: "${DASHBOARD_URL}", mailUrl: "${MAIL_URL}" };
EOF

echo "zonal: wrote ${CONFIG_PATH} (apiUrl=${API_URL:-<unset>}, dashboardUrl=${DASHBOARD_URL:-<unset>}, mailUrl=${MAIL_URL:-<unset>})"
