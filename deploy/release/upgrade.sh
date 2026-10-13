#!/usr/bin/env bash
# Mission Control — apply a release tarball as an upgrade.
#
# Usage:
#   bash deploy/release/upgrade.sh <tarball>
#
# Flow:
#   1. Extract new tarball to versions/vNEW/
#   2. Symlink .env.local + data/ to the state dir (same as install.sh)
#   3. Stop the unit (waiting first for any apt/dpkg it is running), wait for
#      its cgroup to drain, then atomically swap the `current` symlink
#   4. Start the systemd unit
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
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
# Max seconds to wait for an apt/dpkg the dashboard is running (setup page,
# system update) before stopping it anyway, and for the unit's cgroup to empty
# after `stop`.
APT_WAIT_TIMEOUT="${APT_WAIT_TIMEOUT:-900}"
CGROUP_DRAIN_TIMEOUT="${CGROUP_DRAIN_TIMEOUT:-120}"
# Overridable for tests only.
CGROUP_ROOT="${CGROUP_ROOT:-/sys/fs/cgroup}"
PROC_ROOT="${PROC_ROOT:-/proc}"
POLL_SECONDS="${POLL_SECONDS:-1}"
SELF_CGROUP_FILE="${SELF_CGROUP_FILE:-/proc/self/cgroup}"
# Empty (set but blank) means "not available" — tests use that; unset means look it up.
SYSTEMD_RUN="${SYSTEMD_RUN-$(command -v systemd-run 2>/dev/null || true)}"

die() { echo "✗ $*" >&2; exit 1; }
log() { echo "• $*"; }

# `systemctl --user` needs a user D-Bus session. A `sudo -u <owner>` invocation
# — how the OCD deployer and the release E2E drive this script — inherits
# neither XDG_RUNTIME_DIR nor DBUS_SESSION_BUS_ADDRESS, so every systemctl call
# below fails with "Failed to connect to bus: No medium found". Under `set -e`
# that aborts the run AFTER the symlink swap, stranding `current` on a version
# the service never started. Derive the session up front and fail before we
# mutate anything.
ensure_user_bus() {
  local uid; uid="$(id -u)"
  [[ -n "${XDG_RUNTIME_DIR:-}" ]] || export XDG_RUNTIME_DIR="/run/user/$uid"
  [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]] || \
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  systemctl --user show-environment >/dev/null 2>&1 || die \
"cannot reach the systemd user bus for uid $uid (XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR).
   Run as the service owner in a real user session, or enable lingering:
     sudo loginctl enable-linger <owner>"
}

# The unit's cgroup (v2 path relative to $CGROUP_ROOT), e.g.
# /user.slice/user-1000.slice/user@1000.service/app.slice/mission-control.service.
# Empty when the unit is not running or systemd can't tell us.
service_cgroup() {
  systemctl --user show -p ControlGroup --value "$SERVICE" 2>/dev/null || true
}

# PIDs in cgroup $1. A cgroup systemd already removed has no procs file → empty.
cgroup_procs() {
  local cg="$1"
  [[ -n "$cg" && -r "$CGROUP_ROOT$cg/cgroup.procs" ]] || return 0
  cat "$CGROUP_ROOT$cg/cgroup.procs" 2>/dev/null || true
}

# "pid:comm" for every package-manager process inside cgroup $1. `sudo` counts
# too: inside the dashboard's cgroup a sudo is almost always an installer
# (setup page, system update) — a third-party install script runs curl/gpg/bash
# under sudo long before apt itself shows up.
cgroup_apt_procs() {
  local pid comm out=""
  for pid in $(cgroup_procs "$1"); do
    comm="$(cat "$PROC_ROOT/$pid/comm" 2>/dev/null || true)"
    case "$comm" in
      apt|apt-get|aptitude|dpkg|dpkg-deb|unattended-upgr|sudo) out+="$pid:$comm " ;;
    esac
  done
  printf '%s' "$out"
}

# Say so when the waits below can't see anything, instead of silently skipping.
report_cgroup_visibility() {
  local cg="$1"
  if [[ -z "$cg" ]]; then
    log "systemd reports no cgroup for $SERVICE (not running?) — skipping the apt/drain wait"
  elif [[ ! -r "$CGROUP_ROOT$cg/cgroup.procs" ]]; then
    log "⚠ cannot read $CGROUP_ROOT$cg/cgroup.procs (cgroup v1/hybrid?) — skipping the apt/drain wait"
  fi
}

# This script's own cgroup path (v2 "0::<path>", else v1 "N:name=systemd:<path>").
# Empty when unreadable (no /proc, no systemd) — detection is then skipped.
self_cgroup() {
  [[ -r "$SELF_CGROUP_FILE" ]] || return 0
  local line
  line="$(grep -m1 '^0::' "$SELF_CGROUP_FILE" 2>/dev/null || true)"
  [[ -n "$line" ]] || line="$(grep -m1 ':name=systemd:' "$SELF_CGROUP_FILE" 2>/dev/null || true)"
  [[ -n "$line" ]] || return 0
  printf '%s' "$line" | cut -d: -f3-
}

# Is cgroup $1 the service's cgroup $2 (or below it)? With no service cgroup from
# systemd, fall back to matching the unit name $3 in the path.
cgroup_within_service() {
  local self="$1" svc="$2" name="$3"
  [[ -n "$self" ]] || return 1
  if [[ -n "$svc" ]]; then
    [[ "$self" == "$svc" || "$self" == "$svc"/* ]]
    return
  fi
  [[ "$self" == */"$name".service || "$self" == */"$name".service/* ]]
}

# Run from inside the dashboard (its web terminal is in the service's cgroup),
# `systemctl stop` would kill this very script before it swaps `current` and
# starts the new version — leaving the dashboard down. Hand the run to its own
# transient unit instead; refuse when that is impossible.
handoff_if_inside_service() {
  [[ -n "${MCC_UPGRADE_DETACHED:-}" ]] && return 0
  local self svc
  self="$(self_cgroup)"
  [[ -n "$self" ]] || return 0
  svc="$(service_cgroup)"
  cgroup_within_service "$self" "$svc" "$SERVICE" || return 0

  local self_path tarball_abs
  self_path="$(readlink -f "${BASH_SOURCE[0]:-}" 2>/dev/null || true)"
  tarball_abs="$(readlink -f "$TARBALL")"
  if [[ -z "$SYSTEMD_RUN" || -z "$self_path" || ! -f "$self_path" ]]; then
    die "this shell runs inside $SERVICE's own cgroup (e.g. the dashboard's web terminal):
   stopping the service would kill this script before the new version starts.
   systemd-run is not available to move it out — run upgrade.sh over SSH instead."
  fi
  local unit="${SERVICE}-upgrade-$(date +%Y%m%d%H%M%S)"
  "$SYSTEMD_RUN" --user --collect --unit "$unit" \
    --setenv=MCC_UPGRADE_DETACHED=1 \
    --setenv=PATH="$PATH" --setenv=HOME="$HOME" \
    --setenv=PREFIX="$PREFIX" --setenv=STATE="$STATE" --setenv=SERVICE="$SERVICE" \
    --setenv=KEEP_VERSIONS="$KEEP_VERSIONS" --setenv=HEALTH_TIMEOUT="$HEALTH_TIMEOUT" \
    --setenv=APT_WAIT_TIMEOUT="$APT_WAIT_TIMEOUT" --setenv=CGROUP_DRAIN_TIMEOUT="$CGROUP_DRAIN_TIMEOUT" \
    bash "$self_path" "$tarball_abs" \
    || die "systemd-run could not start the upgrade unit — run upgrade.sh over SSH instead"
  echo "• 升級已轉交 systemd 背景執行（unit: $unit），查看進度：journalctl --user -u $unit -f"
  exit 0
}

# The unit is KillMode=control-group: stopping it SIGTERMs every process in its
# cgroup, including a `sudo apt-get` the setup page or a system update started.
# That leaves dpkg "interrupted" and breaks every later apt run. Give such a run
# time to finish first; past the cap, go ahead (the dashboard repairs dpkg on
# its next boot and before its next apt run).
wait_for_service_apt() {
  local cg="$1" waited=0 busy
  busy="$(cgroup_apt_procs "$cg")"
  [[ -z "$busy" ]] && return 0
  log "apt/dpkg is running inside $SERVICE ($busy) — waiting up to ${APT_WAIT_TIMEOUT}s before stopping it"
  while [[ -n "$busy" ]]; do
    if (( waited >= APT_WAIT_TIMEOUT )); then
      echo "⚠ apt/dpkg still running after ${APT_WAIT_TIMEOUT}s ($busy) — stopping $SERVICE anyway" >&2
      return 0
    fi
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
    busy="$(cgroup_apt_procs "$cg")"
  done
  log "apt/dpkg finished"
}

# After `stop`, wait for the old cgroup to empty so nothing from the old version
# is still running (or still holding the dpkg lock) when the new one starts.
drain_cgroup() {
  local cg="$1" waited=0 left
  left="$(cgroup_procs "$cg" | tr '\n' ' ' | sed 's/ *$//')"
  [[ -z "$left" ]] && return 0
  log "waiting up to ${CGROUP_DRAIN_TIMEOUT}s for $SERVICE's cgroup to drain (pids: $left)"
  while [[ -n "$left" ]]; do
    if (( waited >= CGROUP_DRAIN_TIMEOUT )); then
      echo "⚠ $SERVICE cgroup still has processes after ${CGROUP_DRAIN_TIMEOUT}s (pids: $left) — continuing" >&2
      return 0
    fi
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
    left="$(cgroup_procs "$cg" | tr '\n' ' ' | sed 's/ *$//')"
  done
  log "$SERVICE cgroup drained"
}

# The version the service is ACTUALLY serving, per /api/health. This — not the
# `current` symlink — is the source of truth for "is an upgrade needed?".
running_version() {
  local body v
  body="$(curl -sf "$HEALTH_URL" 2>/dev/null || true)"
  v="$(printf '%s' "$body" | sed -En 's/.*"mccVersion": *"([^"]+)".*/\1/p' | head -1)"
  # Legacy semver-only builds predate mccVersion; there `version` IS the bare
  # semver. Paired builds expose both, so mccVersion always wins above.
  if [[ -z "$v" ]]; then
    v="$(printf '%s' "$body" | sed -En 's/.*"version": *"([^"]+)".*/\1/p' | head -1)"
  fi
  printf '%s' "$v"
}

[[ -n "$TARBALL" ]] || die "usage: bash upgrade.sh <path/to/mission-control-vX.Y.Z-linux-x64.tar.gz>"
[[ -f "$TARBALL" ]] || die "tarball not found: $TARBALL"
[[ -d "$PREFIX/current" || -L "$PREFIX/current" ]] || die "no existing install at $PREFIX — run install.sh first"

# The version dir name MUST equal `v<mccVersion>` — the bare MCC semver (e.g.
# "v0.3.57"), matching the OCD deployer's `current` symlink assertion. Read the
# baked version.json `mccVersion` field; never parse it from the filename, where
# a full-version name would make a triple regex capture only the leading prefix.
VERSION_JSON="$(tar xzOf "$TARBALL" ./version.json 2>/dev/null || true)"
VERSION="$(printf '%s' "$VERSION_JSON" | sed -En 's/.*"mccVersion": *"([^"]+)".*/\1/p')"
if [[ -z "$VERSION" ]]; then
  # Older unpaired builds had no mccVersion — `version` was already the bare
  # semver there; fall back to it, then to the filename tail.
  VERSION="$(printf '%s' "$VERSION_JSON" | sed -En 's/.*"version": *"([^"]+)".*/\1/p')"
fi
if [[ -z "$VERSION" ]]; then
  VERSION="$(basename "$TARBALL" | sed -En 's/^mission-control-v(.+)-linux-x64\.tar\.gz$/\1/p')"
fi
[[ -n "$VERSION" ]] || die "could not determine version from $TARBALL"

# Resolve the version `current` POINTS AT (dirname of the symlink target). Note
# this is only what should be running — see RUNNING_VERSION below.
CURRENT_LINK="$(readlink -f "$PREFIX/current" || true)"
CURRENT_VERSION=""
if [[ -n "$CURRENT_LINK" ]]; then
  CURRENT_VERSION="$(basename "$CURRENT_LINK" | sed -E 's/^v//')"
fi

PORT="$(grep -E '^PORT=' "$STATE/.env.local" 2>/dev/null | head -1 | cut -d= -f2)"
PORT="${PORT:-3737}"
HEALTH_URL="http://127.0.0.1:$PORT/api/health"

# Skip only when the service is REALLY serving this version. Keying the no-op
# off the symlink alone made a half-finished upgrade unrecoverable: a run that
# swapped `current` and then died (see ensure_user_bus) leaves the link on vNEW
# while the old process keeps serving, and every re-run would report "nothing to
# do" while the stale code stayed live. An unreachable health endpoint yields an
# empty RUNNING_VERSION, which correctly falls through to the upgrade.
RUNNING_VERSION="$(running_version)"

if [[ "$VERSION" == "$CURRENT_VERSION" && "$VERSION" == "$RUNNING_VERSION" ]]; then
  log "v$VERSION is already the running version — nothing to do"
  exit 0
fi

if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  log "current → v$VERSION but the service is serving ${RUNNING_VERSION:-nothing}"
  log "completing the interrupted upgrade to v$VERSION"
else
  log "upgrading v${CURRENT_VERSION:-?} → v$VERSION"
fi

# Fail before touching the symlink if we can't drive systemd.
ensure_user_bus

# Before extracting anything: if we're running inside the service's own cgroup,
# re-run as a separate transient unit (or refuse).
handoff_if_inside_service

NEW_DIR="$PREFIX/versions/v$VERSION"
# Reuse the existing tree ONLY when it is actually this tarball. Reusing on
# directory-existence alone silently ships stale code whenever a version number
# is reused with different content — during a rebuild, or a re-cut release. That
# bit us on 2026-09-02: a release candidate "passed" the full E2E while the box
# was still serving an older build, because versions/v0.3.84 already existed
# from an earlier test build and was reused. The deploy logged success and
# /api/health reported the OLD commit.
TARBALL_STAMP="$(tar xzOf "$TARBALL" ./version.json 2>/dev/null || true)"
if [[ -d "$NEW_DIR" ]]; then
  EXISTING_STAMP="$(cat "$NEW_DIR/version.json" 2>/dev/null || true)"
  if [[ -n "$TARBALL_STAMP" && "$EXISTING_STAMP" == "$TARBALL_STAMP" ]]; then
    log "reusing existing $NEW_DIR (already extracted, matches tarball)"
  else
    log "replacing $NEW_DIR — existing tree does not match this tarball"
    rm -rf "$NEW_DIR"
    mkdir -p "$NEW_DIR"
    log "extracting → $NEW_DIR"
    tar xzf "$TARBALL" -C "$NEW_DIR"
  fi
else
  mkdir -p "$NEW_DIR"
  log "extracting → $NEW_DIR"
  tar xzf "$TARBALL" -C "$NEW_DIR"
fi

# Pre-flight: the release bundles better-sqlite3 native prebuilds for a fixed
# set of Node ABIs (NMV, `process.versions.modules`). If this box runs a Node
# whose ABI isn't bundled, the dashboard can't load better-sqlite3 and would
# fail to boot — otherwise caught only after the 120s health timeout + rollback,
# or (on a fresh install) not at all. Check against what's ACTUALLY bundled in
# the extracted tree (not a hardcoded list) BEFORE the symlink swap, so a
# mismatch fails fast and leaves the running install untouched.
NODE_NMV="$(node -p 'process.versions.modules' 2>/dev/null || true)"
BINDING_DIR="$NEW_DIR/node_modules/better-sqlite3/lib/binding"
if [[ -n "$NODE_NMV" && -d "$BINDING_DIR" ]]; then
  if [[ ! -d "$BINDING_DIR/node-v$NODE_NMV-linux-x64" ]]; then
    HAVE_ABIS="$(ls -1 "$BINDING_DIR" 2>/dev/null | sed -En 's/^node-v([0-9]+)-linux-x64$/\1/p' | paste -sd, -)"
    die "Node $(node --version) (ABI $NODE_NMV) has no bundled better-sqlite3 \
prebuild in this release (bundled ABIs: ${HAVE_ABIS:-none}).
   Switch to a supported Node major, or use a release built for this ABI.
   The running install was left untouched."
  fi
fi

# State-dir symlinks (matches install.sh).
ln -sf "$STATE/.env.local" "$NEW_DIR/.env.local"
rm -rf "$NEW_DIR/data" 2>/dev/null || true
ln -sf "$STATE/data" "$NEW_DIR/data"

# Ensure state/logs exists — older installs may have relied on /var/log.
mkdir -p "$STATE/logs"

PREV_LINK_TARGET="$CURRENT_LINK"

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
        -e "s|__NODE_DIR__|$(dirname "$NODE_BIN")|g" \
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

# Log rotation timer — installs it on machines that predate it, refreshes it
# on the rest. Non-fatal by design.
if [[ -f "$NEW_DIR/install/install-logrotate.sh" ]]; then
  bash "$NEW_DIR/install/install-logrotate.sh" "$NEW_DIR/install" "$STATE" "$SERVICE"
fi

# Stop → drain → swap → start, rather than swap + restart: the old process
# must not be running (or killing an apt mid-run) while `current` already points
# at the new tree. The unit re-render above only needs daemon-reload, which is
# fine while the old version still runs; it takes effect on this start.
SERVICE_CG="$(service_cgroup)"
report_cgroup_visibility "$SERVICE_CG"
wait_for_service_apt "$SERVICE_CG"
systemctl --user stop "$SERVICE"
drain_cgroup "$SERVICE_CG"

# Atomic swap of `current` — `ln -sfn` replaces the link without a window
# where `current` briefly doesn't exist.
ln -sfn "$NEW_DIR" "$PREFIX/current"
log "current → versions/v$VERSION"

# Start and wait for health. (PORT/HEALTH_URL were resolved before the
# no-op check so the running-version probe could use them.)
systemctl --user start "$SERVICE"

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
    ROLLBACK_CG="$(service_cgroup)"
    systemctl --user stop "$SERVICE"
    drain_cgroup "$ROLLBACK_CG"
    ln -sfn "$PREV_LINK_TARGET" "$PREFIX/current"
    systemctl --user start "$SERVICE"
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
