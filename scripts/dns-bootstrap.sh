#!/usr/bin/env bash
# One-time bootstrap for the managed-DNS (PowerDNS) backend.
#
# Creates the dedicated `pdns` database inside the shared Postgres server and
# loads the PowerDNS gpgsql schema into it. Safe to re-run: the CREATE DATABASE
# is skipped if it already exists, and the schema uses CREATE TABLE IF NOT EXISTS.
#
# Run from the repo root AFTER `docker compose up -d postgres`:
#   ./scripts/dns-bootstrap.sh
#
# Then bring up PowerDNS:
#   docker compose up -d pdns
#
# Env (read from .env if present): POSTGRES_USER, POSTGRES_DB, PDNS_DB.
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present (for POSTGRES_USER / POSTGRES_DB / PDNS_DB).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PG_USER="${POSTGRES_USER:-zonal}"
PG_DB="${POSTGRES_DB:-zonal}"
PDNS_DB="${PDNS_DB:-pdns}"

echo "==> Ensuring database '${PDNS_DB}' exists (owner ${PG_USER})"
# gexec runs the generated CREATE DATABASE only when it does not already exist.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" <<SQL
SELECT 'CREATE DATABASE "${PDNS_DB}" OWNER "${PG_USER}"'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PDNS_DB}')\gexec
SQL

echo "==> Loading PowerDNS schema into '${PDNS_DB}'"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PDNS_DB}" \
  < services/dns/schema.sql

echo "==> Done. Start PowerDNS with:  docker compose up -d pdns"
