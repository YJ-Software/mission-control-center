---
name: release
description: Cut and publish a new Mission Control release to GitHub Releases. Use this skill whenever the user says "發版", "release", "release v…", "cut a release", "publish a release", "做 release", "bump version and publish", or asks about how to release a new version. Triggers on any intent to produce a new published version that customers can upgrade to — even if the user doesn't say "release" explicitly (e.g. "push out the new build", "ship v0.1.2").
---

# Release a new version of Mission Control

This project ships release tarballs through **GitHub Releases**, with a manifest in the repo at `release-manifest.json` (served via `raw.githubusercontent.com`). Customer dashboards poll the manifest and upgrade from there. A "release" means: bump the version, build the standalone tarball, **validate it against a throwaway box**, upload it to GitHub Releases, and push the manifest update.

The procedure below is **rigid** — do the steps in order, don't skip. The build pipeline destroys `.next/`, so the dev-server dance (steps 4 and 9) is not optional on this machine.

## Versioning convention

Each release is **paired with an openclaw version**. The display version is `<openclawVersion>-v<mccVersion>`, e.g. `2026.6.1-v0.3.52`. The pairing means: this MCC tarball passed the full Playwright E2E on a throwaway box running that openclaw version. Customers see the combined string in the sidebar, manifest, and GitHub release tag.

`build-release.mjs` detects the local `openclaw --version` at build time and bakes it into `version.json`. When validating against a throwaway running a different openclaw (common — the dev machine usually lags), override with:

```bash
MCC_OPENCLAW_VERSION=2026.6.1 npm run build:release
```

If `openclaw` isn't on PATH at all, the build still works but the release publishes unpaired (display falls back to `v0.3.52` only).

## Before starting

Confirm two things with the user if they're ambiguous:

1. **Semver level** — `patch` (0.1.0 → 0.1.1, default for bug fixes), `minor` (0.1.0 → 0.2.0, new features), or `major` (0.1.0 → 1.0.0, breaking changes). If unspecified and the diff looks like a mix of fixes + small features, default to `patch` and mention that choice.
2. **Release notes** — ask if they want notes. If yes, collect them (short markdown list) and pass via `MCC_NOTES`. If no, skip — the script will fall back to `gh --generate-notes`.

Also check that `gh` is authenticated:

```bash
gh auth status
```

If not, ask the user to `gh auth login`. The publish step calls `gh release create|upload`.

## Pre-flight check (step 1)

```bash
git status                  # must be clean
git branch --show-current   # should be main
```

If dirty or wrong branch, **stop and tell the user**. Releases must only come from clean `main`.

## Bump version + push (steps 2–3)

```bash
npm version patch     # or minor / major based on user's choice
git push --follow-tags
```

`npm version` rewrites `package.json`, makes a commit titled with the new version, and creates a lightweight git tag (e.g. `v0.1.2`). `--follow-tags` pushes the tag together with the commit.

## Stop the dev server (step 4)

```bash
systemctl --user stop mission-control
```

`npm run build:release` runs `rm -rf .next` for a clean build. The dev unit's Turbopack cache lives in `.next/dev/` — nuking it while running corrupts the cache. Stop first, restart in step 8.

## Build the tarball (step 5)

First check the openclaw version running on the throwaway you'll validate against — that's the pairing we want baked into the tarball:

```bash
# On the throwaway (or via SSH using .env.e2e.local creds):
sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version
# → OpenClaw 2026.6.1 (sha)
```

Then build, overriding the openclaw version if the local one differs:

```bash
MCC_OPENCLAW_VERSION=2026.6.1 npm run build:release
```

Takes 20–40 s. Produces `dist/mission-control-vX.Y.Z-linux-x64.tar.gz` (~25 MB) plus the install scripts. Pipeline lives in `scripts/build-release.mjs`.

Verify the bake before continuing:

```bash
tar xzOf dist/mission-control-v*-linux-x64.tar.gz ./version.json
# Should show { "version": "2026.6.1-v0.X.Y", "mccVersion": "0.X.Y", "openclawVersion": "2026.6.1", ... }
```

## Validate on throwaway (step 6) — required gate before publish

**This step is what gives the paired version its meaning.** Don't skip — the whole point of `2026.6.1-v0.3.52` is "this MCC passed E2E against that openclaw". A release that hasn't gone through this is a lie.

Upgrade the throwaway to the freshly-built tarball, then run the full E2E suite against it:

```bash
# 1. Trigger upgrade via the dashboard's update-mcc action — the throwaway's
#    /api/upgrade/check will pick up the new manifest entry only AFTER publish,
#    so for pre-publish validation push the tarball manually:
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'

# 2. Wait for the new version to come up healthy
until curl -s --max-time 5 http://$E2E_SSH_HOST:3737/api/health | grep -q "\"mccVersion\":\"$(node -p 'require(\"./package.json\").version')\""; do sleep 5; done
curl -s http://$E2E_SSH_HOST:3737/api/health
# → "version":"2026.6.1-v0.3.52","mccVersion":"0.3.52","openclawVersion":"2026.6.1"

# 3. Run the full Playwright E2E suite
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e
```

**Pass criteria:** all tests green (or only known-upstream failures, like the openclaw isolated-cron model-default bug — flag those to the user before proceeding).

If E2E fails:
- Fix the bug (in MCC or note as upstream-known)
- Rebuild (`npm run build:release`)
- Re-upgrade the throwaway
- Re-run E2E
- Only proceed to publish when the suite is clean

If the failure is environmental (e.g. throwaway state pollution from a prior run), the spec is buggy — fix the spec to be idempotent, don't waive.

## Publish (steps 7–8)

With release notes:

```bash
MCC_NOTES="- fix(auth): something
- feat(chat): something" npm run publish:release
```

Without notes:

```bash
npm run publish:release
```

`publish:release` (`scripts/publish-release.mjs`):
- computes sha256 + size of the tarball
- updates `release-manifest.json` (latest + history rotation, prior entry pushed to `history[]`, max 10)
- runs `gh release create vX.Y.Z dist/*.tar.gz` (or `gh release upload --clobber` if the tag's release already exists)
- `git add release-manifest.json && git commit -m "chore(release): publish vX.Y.Z" && git push origin HEAD`

Watch the output for `live check: HTTP 200` against the raw GitHub manifest URL — that's the green light. If non-200, the push hasn't propagated yet (raw.githubusercontent.com has up to a few minutes of caching) — wait and re-curl.

Useful escape hatches:
- `MCC_NO_GH=1 npm run publish:release` — skip the GitHub upload (manifest-only)
- `MCC_NO_PUSH=1 npm run publish:release` — skip the git commit + push

## Restart the dev server (step 9)

```bash
systemctl --user start mission-control
```

## Verify (step 10)

```bash
# Public manifest — should show the new version (raw.githubusercontent has up to ~5 min cache)
curl -sL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json | head -30

# GitHub release page
gh release view v$(node -p "require('./package.json').version")

# Local dashboard
curl -s http://127.0.0.1:3737/api/upgrade/check
```

Right after a release, `current` == `latest` (the dev server also runs the new version since `package.json` was bumped). That's expected.

Report back with:
- New version number
- GitHub release URL
- Manifest URL HTTP status

## Rollback (if something is wrong)

If the new release is bad:

```bash
# Edit manifest to point latest back to a known-good version
vim release-manifest.json

# Push the manifest revert
git add release-manifest.json
git commit -m "chore(release): rollback to vX.Y.Z"
git push

# Optional: delete the bad GitHub release (or keep it as a draft)
gh release delete vBAD --yes
```

Customer dashboards on the bad version will see the manifest report an "older" `latest` and can re-Upgrade (downgrade) via the UI.

## Key facts about the release infrastructure

- **Manifest:** `release-manifest.json` at repo root, served at `https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json`
- **Tarballs:** GitHub Releases at `https://github.com/YJ-Software/mission-control-center/releases/download/vX.Y.Z/<asset>`
- **Manifest URL stored per install:** settings DB key `upgrade.manifestUrl` (env `UPGRADE_MANIFEST_URL` is fallback). Seeded by `initDb()` to the GitHub raw URL on first run.
- **Dev server unit:** `mission-control` (user), serves at `http://127.0.0.1:3737`

## One-shot copy-paste version

```bash
# 1. Pre-flight + bump
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. Build paired with throwaway's openclaw
systemctl --user stop mission-control
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
OC_VER="$(ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version' | sed -En 's/OpenClaw ([0-9.]+).*/\1/p')"
MCC_OPENCLAW_VERSION="$OC_VER" npm run build:release

# 3. Validate on throwaway (REQUIRED — pairing claim depends on this)
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e

# 4. Only after E2E green: publish + restart
MCC_NOTES="- …" npm run publish:release       # MCC_NOTES optional
systemctl --user start mission-control
curl -sL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json | head -30
```
