#!/usr/bin/env bash
# Mission Control — one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/install.sh | bash
#
# Optional env vars:
#   MCC_VERSION   pin a specific version (e.g. 0.2.0). default: latest from manifest
#   MCC_REPO      override repo (owner/name). default: YJ-Software/mission-control-center
#   MCC_BRANCH    branch to read manifest from. default: main
#   PREFIX        install root. default: $HOME/mission-control
#   STATE         state dir. default: $HOME/.mission-control
#   INSTALL_PORT  HTTP port. default: 3737
#
# What it does:
#   1. Fetches release-manifest.json from raw.githubusercontent.com
#   2. Downloads the matching tarball + verifies sha256
#   3. Extracts and hands off to install/install.sh inside the tarball

set -euo pipefail

MCC_REPO="${MCC_REPO:-YJ-Software/mission-control-center}"
MCC_BRANCH="${MCC_BRANCH:-main}"
MCC_VERSION="${MCC_VERSION:-}"
MANIFEST_URL="https://raw.githubusercontent.com/${MCC_REPO}/${MCC_BRANCH}/release-manifest.json"

die() { echo "✗ $*" >&2; exit 1; }
log() { echo "• $*"; }

for bin in curl tar node; do
  command -v "$bin" >/dev/null || die "$bin not found in PATH"
done

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_TAG="x64" ;;
  aarch64|arm64) ARCH_TAG="arm64" ;;
  *) die "unsupported arch: $ARCH" ;;
esac
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
[[ "$PLATFORM" == "linux" ]] || die "unsupported platform: $PLATFORM (only linux is supported)"

log "fetching manifest from $MANIFEST_URL"
MANIFEST="$(curl -fsSL "$MANIFEST_URL")" || die "could not fetch manifest"

# Pick artifact: latest by default, or scan history[] when MCC_VERSION pinned.
PARSED="$(MCC_VERSION="$MCC_VERSION" PLATFORM="$PLATFORM" ARCH_TAG="$ARCH_TAG" \
  node -e '
    const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const want = process.env.MCC_VERSION || "";
    const platform = process.env.PLATFORM;
    const arch = process.env.ARCH_TAG;
    const candidates = [m.latest, ...(m.history || [])];
    const release = want
      ? candidates.find(r => r && r.version === want)
      : m.latest;
    if (!release) { console.error("version not found in manifest:", want || "(latest)"); process.exit(2) }
    const a = (release.artifacts || []).find(x => x.platform === platform && x.arch === arch);
    if (!a) { console.error("no artifact for", platform, arch, "in v" + release.version); process.exit(2) }
    process.stdout.write([a.url, a.sha256, release.version].join(" "));
  ' <<<"$MANIFEST")" || die "manifest parse failed"
read -r URL SHA256 VERSION <<<"$PARSED"

log "selected v$VERSION ($PLATFORM-$ARCH_TAG)"
log "  $URL"

WORK="$(mktemp -d -t mcc-install-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

TARBALL="$WORK/mission-control-v${VERSION}-${PLATFORM}-${ARCH_TAG}.tar.gz"
log "downloading tarball"
curl -fL --progress-bar -o "$TARBALL" "$URL" || die "download failed"

ACTUAL_SHA="$(sha256sum "$TARBALL" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$SHA256" ]]; then
  die "sha256 mismatch: expected $SHA256, got $ACTUAL_SHA"
fi
log "sha256 verified"

# Extract just the bootstrap scripts so we can run install.sh against the tarball.
mkdir -p "$WORK/bootstrap"
tar xzf "$TARBALL" -C "$WORK/bootstrap" ./install || die "tarball missing ./install/ scripts"

INSTALLER="$WORK/bootstrap/install/install.sh"
[[ -f "$INSTALLER" ]] || die "install/install.sh not found in tarball"

log "running installer"
exec bash "$INSTALLER" "$TARBALL"
