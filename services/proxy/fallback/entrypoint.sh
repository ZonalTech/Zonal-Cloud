#!/bin/sh
# Runs from the official nginx image's /docker-entrypoint.d/ hook directory
# BEFORE nginx starts. It renders the landing page from a read-only template
# into nginx's web root, injecting the dashboard origin. Returns when done —
# the image's own launcher starts nginx afterwards. Runtime substitution means
# the same image works in dev and on the VPS just by changing DASHBOARD_URL.
set -e

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:5173}"

# Render template (mounted read-only) into the served web root, replacing
# the %%DASHBOARD_URL%% placeholder. We write to the image's own filesystem,
# never back to the mounted template, so the host source stays untouched.
sed "s|%%DASHBOARD_URL%%|${DASHBOARD_URL}|g" \
  /opt/fallback-template/index.html \
  > /usr/share/nginx/html/index.html
