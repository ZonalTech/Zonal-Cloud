#!/usr/bin/env bash
# test-deploy.sh — manual deploy check using curl.
# Calls POST /v1/apps/:id/deploy directly without act or GitHub Actions.
# Use this to verify your deploy token and app ID before wiring up the full workflow.
#
# Usage:
#   export APP_ID=<your_app_id>
#   export API_BASE=http://localhost:4000
#   export ZONAL_TOKEN=<your_deploy_token>
#   bash ci/test-deploy.sh

set -euo pipefail

# Read from environment with defaults.
APP_ID="${APP_ID:?APP_ID is required. Export APP_ID=<your_app_id>}"
API_BASE="${API_BASE:-http://localhost:4000}"
ZONAL_TOKEN="${ZONAL_TOKEN:?ZONAL_TOKEN is required. Export ZONAL_TOKEN=<your_deploy_token>}"

# Use current git SHA if available, otherwise fall back to HEAD label.
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "manual-test")
GIT_REF=$(git symbolic-ref HEAD 2>/dev/null || echo "refs/heads/main")

DEPLOY_URL="${API_BASE}/v1/apps/${APP_ID}/deploy"

echo "---"
echo "Zonal Cloud - manual deploy test"
echo "API base   : ${API_BASE}"
echo "App ID     : ${APP_ID}"
echo "Endpoint   : ${DEPLOY_URL}"
echo "Git SHA    : ${GIT_SHA}"
echo "Git ref    : ${GIT_REF}"
echo "---"

RESPONSE=$(curl --silent --show-error \
  --max-time 30 \
  -X POST "${DEPLOY_URL}" \
  -H "Authorization: Bearer ${ZONAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"ref\": \"${GIT_SHA}\", \"branch\": \"${GIT_REF}\"}" \
  -w "\n__HTTP_STATUS__:%{http_code}" \
)

HTTP_STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__:[0-9]*$//')

echo "HTTP status : ${HTTP_STATUS}"
echo "Response    :"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo "---"

if [ -z "$HTTP_STATUS" ] || [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  echo "FAIL: deploy API returned non-2xx status: ${HTTP_STATUS}"
  exit 1
fi

echo "OK: deploy triggered successfully."
