#!/usr/bin/env bash
# Install (or refresh) the user-level logrotate timer for the dashboard log.
# Called by both install.sh and upgrade.sh so machines installed before this
# existed pick it up on their next upgrade.
#
# Usage: bash install-logrotate.sh <template-dir> <state-dir> <service-name>
#
# Never fatal: a missing logrotate binary leaves the log unrotated (the old
# behaviour) rather than failing an install or upgrade.

set -uo pipefail

TMPL_DIR="${1:?template dir}"
STATE="${2:?state dir}"
SERVICE="${3:?service name}"
SYSTEMD_DIR="$HOME/.config/systemd/user"
UNIT="$SERVICE-logrotate"

log() { echo "• $*"; }

# Resolved from PATH only. If a script caller's PATH lacks /usr/sbin, the
# dashboard re-runs this at startup under the unit's PATH, which includes it.
LOGROTATE_BIN="$(command -v logrotate || true)"
if [[ -z "$LOGROTATE_BIN" ]]; then
  log "  (non-fatal) logrotate not found; log rotation not installed"
  log "  → sudo apt-get install -y logrotate, then re-run: bash $TMPL_DIR/install-logrotate.sh $TMPL_DIR $STATE $SERVICE"
  exit 0
fi

for f in mission-control-logrotate.conf.tmpl mission-control-logrotate.service.tmpl mission-control-logrotate.timer.tmpl; do
  if [[ ! -f "$TMPL_DIR/$f" ]]; then
    log "  (non-fatal) template missing: $TMPL_DIR/$f; log rotation not installed"
    exit 0
  fi
done

render() {
  sed -e "s|__STATE__|$STATE|g" -e "s|__LOGROTATE_BIN__|$LOGROTATE_BIN|g" "$1"
}

mkdir -p "$SYSTEMD_DIR" "$STATE/logs"
render "$TMPL_DIR/mission-control-logrotate.conf.tmpl" > "$STATE/logrotate.conf"
render "$TMPL_DIR/mission-control-logrotate.service.tmpl" > "$SYSTEMD_DIR/$UNIT.service"
render "$TMPL_DIR/mission-control-logrotate.timer.tmpl" > "$SYSTEMD_DIR/$UNIT.timer"

systemctl --user daemon-reload
if systemctl --user enable --now "$UNIT.timer" >/dev/null 2>&1; then
  log "log rotation: $UNIT.timer enabled (hourly, 20M × 5, copytruncate)"
else
  log "  (non-fatal) could not enable $UNIT.timer"
fi
exit 0
