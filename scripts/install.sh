#!/usr/bin/env bash
#
# Zonal Cloud bootstrap installer.
#
# The CLI and the platform are SEPARATE: this script only sets up the operator
# CLI (zone, from npm). The CLI then pulls the platform as prebuilt images
# from a registry — there is NO platform source on the server.
#
# One-line install on a fresh Linux server:
#
#   curl -fsSL https://raw.githubusercontent.com/ZonalTech/Zonal-Cloud/main/scripts/install.sh | bash -s -- \
#     --domain example.com --acme-email you@example.com
#
# Or set up the CLI only (no install) and run it yourself:
#
#   curl -fsSL https://raw.githubusercontent.com/ZonalTech/Zonal-Cloud/main/scripts/install.sh | ZONAL_NO_INSTALL=1 bash
#
# What it does:
#   1. Installs prerequisites: curl + Node.js 20 (via NodeSource) if missing.
#   2. Installs the CLI globally:  npm i -g @zonalcloud/zone
#   3. Hands off to `zone install --install-docker`, forwarding your args.
#
# Configurable via environment:
#   ZONAL_CLI_PKG     npm package/spec  (default: @zonalcloud/zone)
#   ZONAL_NO_INSTALL  =1 to set up the CLI but skip `zone install`

set -euo pipefail

ZONAL_CLI_PKG="${ZONAL_CLI_PKG:-@zonalcloud/zone}"

log()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else
    die "This script needs root to install packages. Run as root or install sudo."
  fi
fi
have() { command -v "$1" >/dev/null 2>&1; }

detect_pm() {
  if have apt-get; then echo apt
  elif have dnf;    then echo dnf
  elif have yum;    then echo yum
  else echo unknown; fi
}
PM="$(detect_pm)"

pkg_install() {
  case "$PM" in
    apt) $SUDO apt-get update -y && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf) $SUDO dnf install -y "$@" ;;
    yum) $SUDO yum install -y "$@" ;;
    *)   die "Unsupported package manager. Install these manually and re-run: $*" ;;
  esac
}

# ----------------------------------------------------------------------------
# 1. Prerequisites: curl, Node 20+
# ----------------------------------------------------------------------------
log "Checking prerequisites"
[ "$(uname -s)" = "Linux" ] || info "Warning: this installer targets Linux servers; continuing anyway."

have curl || { info "Installing curl..."; pkg_install curl ca-certificates; }

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if ! have node || [ "$(node_major)" -lt 20 ] 2>/dev/null; then
  info "Installing Node.js 20 (via NodeSource)..."
  case "$PM" in
    apt)     curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - ; pkg_install nodejs ;;
    dnf|yum) curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO -E bash - ; pkg_install nodejs ;;
    *)       die "Install Node.js 20+ manually, then re-run." ;;
  esac
else
  info "Node $(node -v) present."
fi
have node || die "Node.js install failed."
info "node $(node -v), npm $(npm -v)"

# ----------------------------------------------------------------------------
# 2. Install the CLI from npm
# ----------------------------------------------------------------------------
log "Installing the zone CLI ($ZONAL_CLI_PKG)"
if npm install -g "$ZONAL_CLI_PKG" >/dev/null 2>&1; then
  info "Installed globally."
else
  info "Global install needs elevated permissions; using sudo."
  $SUDO npm install -g "$ZONAL_CLI_PKG"
fi
have zone || die "zone did not land on PATH after install. Check your npm global bin dir is on PATH."
info "zone $(zone --version) ready"

# ----------------------------------------------------------------------------
# 3. Hand off to the installer
# ----------------------------------------------------------------------------
if [ "${ZONAL_NO_INSTALL:-0}" = "1" ]; then
  log "CLI ready (skipping install)."
  info "Run the install yourself, e.g.:"
  info "  zone install --domain example.com --acme-email you@example.com --install-docker"
  exit 0
fi

log "Starting installation"
info "Forwarding arguments to: zone install --install-docker $*"
# --install-docker is implied on a fresh server; the CLI no-ops it if Docker
# is already present.
exec zone install --install-docker "$@"
