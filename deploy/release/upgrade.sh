#!/usr/bin/env bash
# Mission Control — apply a release tarball as an upgrade.
#
# Usage:
#   bash deploy/release/upgrade.sh <tarball>
#
# Flow:
#   1. Extract new tarball to versions/vNEW/
#   2. Symlink .env.local + data/ to the state dir (same as install.sh)
#   3. Atomically swap the `current` symlink
#   4. Restart the systemd unit
#   5. Poll /api/health until the new version responds (rollback on timeout)
#   6. Prune — keep the 3 most recent versions
#
# This script is idempotent-ish: running with the currently-installed version
# is a no-op (exits with a message).

set -euo pipefail

TARBALL="${1:-}"
PREFIX="${PREFIX:-$HOME/mission-control}"
STATE="${STATE:-$HOME/.mission-control}"
SERVICE="${SERVICE:-mission-control}"
KEEP_VERSIONS="${KEEP_VERSIONS:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

die() { echo "✗ $*" >&2; exit 1; }
log() { echo "• $*"; }

[[ -n "$TARBALL" ]] || die "usage: bash upgrade.sh <path/to/mission-control-vX.Y.Z-linux-x64.tar.gz>"
[[ -f "$TARBALL" ]] || die "tarball not found: $TARBALL"
[[ -d "$PREFIX/current" || -L "$PREFIX/current" ]] || die "no existing install at $PREFIX — run install.sh first"

VERSION="$(basename "$TARBALL" | sed -En 's/^mission-control-v([0-9]+\.[0-9]+\.[0-9]+)-.*\.tar\.gz$/\1/p')"
if [[ -z "$VERSION" ]]; then
  # Prefer the bare semver (mccVersion) if the build added it, otherwise fall
  # back to whatever's in `version` (older builds before openclaw pairing).
  VERSION_JSON="$(tar xzOf "$TARBALL" ./version.json 2>/dev/null || true)"
  VERSION="$(echo "$VERSION_JSON" | sed -En 's/.*"mccVersion": *"([^"]+)".*/\1/p')"
  if [[ -z "$VERSION" ]]; then
    VERSION="$(echo "$VERSION_JSON" | sed -En 's/.*"version": *"([^"]+)".*/\1/p' || true)"
  fi
fi
[[ -n "$VERSION" ]] || die "could not determine version from $TARBALL"

# Resolve current version (dirname of the symlink target).
CURRENT_LINK="$(readlink -f "$PREFIX/current" || true)"
CURRENT_VERSION=""
if [[ -n "$CURRENT_LINK" ]]; then
  CURRENT_VERSION="$(basename "$CURRENT_LINK" | sed -E 's/^v//')"
fi

if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  log "v$VERSION is already the running version — nothing to do"
  exit 0
fi

log "upgrading v${CURRENT_VERSION:-?} → v$VERSION"

NEW_DIR="$PREFIX/versions/v$VERSION"
if [[ -d "$NEW_DIR" ]]; then
  log "reusing existing $NEW_DIR (already extracted)"
else
  mkdir -p "$NEW_DIR"
  log "extracting → $NEW_DIR"
  tar xzf "$TARBALL" -C "$NEW_DIR"
fi

# State-dir symlinks (matches install.sh).
ln -sf "$STATE/.env.local" "$NEW_DIR/.env.local"
rm -rf "$NEW_DIR/data" 2>/dev/null || true
ln -sf "$STATE/data" "$NEW_DIR/data"

# Ensure state/logs exists — older installs may have relied on /var/log.
mkdir -p "$STATE/logs"

# Atomic swap of `current` — `ln -sfn` replaces the link without a window
# where `current` briefly doesn't exist.
PREV_LINK_TARGET="$CURRENT_LINK"
ln -sfn "$NEW_DIR" "$PREFIX/current"
log "current → versions/v$VERSION"

# Re-render the systemd unit from the new template if it changed. Older
# releases may have shipped a unit with directives that no longer match what
# the dashboard needs (e.g. NoNewPrivileges blocking sudo-based installers).
# Without this, the unit stays whatever the original install.sh wrote until
# the operator manually re-renders it.
SYSTEMD_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$SYSTEMD_DIR/$SERVICE.service"
TMPL="$NEW_DIR/install/mission-control.service.tmpl"
if [[ -f "$TMPL" ]]; then
  NODE_BIN="$(command -v node || true)"
  if [[ -n "$NODE_BIN" ]]; then
    NEW_UNIT="$(mktemp)"
    sed -e "s|__NODE_BIN__|$NODE_BIN|g" \
        -e "s|__STATE__|$STATE|g" \
        -e "s|__PREFIX__|$PREFIX|g" \
      "$TMPL" > "$NEW_UNIT"
    if [[ ! -f "$UNIT_FILE" ]] || ! cmp -s "$NEW_UNIT" "$UNIT_FILE"; then
      mkdir -p "$SYSTEMD_DIR"
      mv "$NEW_UNIT" "$UNIT_FILE"
      log "systemd unit updated from new template — reloading"
      systemctl --user daemon-reload
    else
      rm -f "$NEW_UNIT"
    fi
  fi
fi

# Restart and wait for health.
systemctl --user restart "$SERVICE"

PORT="$(grep -E '^PORT=' "$STATE/.env.local" | head -1 | cut -d= -f2)"
PORT="${PORT:-3737}"
HEALTH_URL="http://127.0.0.1:$PORT/api/health"

log "waiting up to ${HEALTH_TIMEOUT}s for v$VERSION on $HEALTH_URL …"
HEALTHY=""
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
  RESPONSE="$(curl -sf "$HEALTH_URL" 2>/dev/null || true)"
  # Match either "mccVersion":"X.Y.Z" (post-pairing builds expose it) or
  # the legacy "version":"X.Y.Z" (semver-only builds before openclaw pairing).
  if echo "$RESPONSE" | grep -qE "\"(mccVersion|version)\":\"$VERSION\""; then
    HEALTHY=yes
    break
  fi
  sleep 1
done

if [[ -z "$HEALTHY" ]]; then
  echo "✗ v$VERSION did not become healthy within ${HEALTH_TIMEOUT}s — rolling back" >&2
  if [[ -n "$PREV_LINK_TARGET" ]]; then
    ln -sfn "$PREV_LINK_TARGET" "$PREFIX/current"
    systemctl --user restart "$SERVICE"
    echo "  rolled back to $(basename "$PREV_LINK_TARGET")" >&2
  fi
  exit 1
fi

log "health OK: $RESPONSE"

# Prune old versions (keep the $KEEP_VERSIONS most recent).
if [[ "$KEEP_VERSIONS" -gt 0 ]]; then
  mapfile -t OLD < <(ls -1dt "$PREFIX/versions"/v* 2>/dev/null | tail -n +$((KEEP_VERSIONS + 1)))
  for old in "${OLD[@]:-}"; do
    [[ -z "$old" ]] && continue
    log "pruning old version: $(basename "$old")"
    rm -rf "$old"
  done
fi

echo
echo "✓ upgraded to Mission Control v$VERSION"
