---
name: release
description: Cut and publish a new Mission Control release to GitHub Releases. Use this skill whenever the user says "發版", "release", "release v…", "cut a release", "publish a release", "做 release", "bump version and publish", or asks about how to release a new version. Triggers on any intent to produce a new published version that customers can upgrade to — even if the user doesn't say "release" explicitly (e.g. "push out the new build", "ship v0.1.2").
---

# Release a new version of Mission Control

This project ships release tarballs through **GitHub Releases**, with a manifest in the repo at `release-manifest.json` (served via `raw.githubusercontent.com`). Customer dashboards poll the manifest and upgrade from there. A "release" means: bump the version, build the standalone tarball, **validate it against a throwaway box**, upload it to GitHub Releases, and push the manifest update.

The procedure below is **rigid** — do the steps in order, don't skip. The build pipeline destroys `.next/`, so the dev-server dance (steps 4 and 9) is not optional on this machine.

## Versioning convention

Each release is **paired with an openclaw version**. Display: `<openclawVersion>-v<mccVersion>`, e.g. `2026.6.1-v0.3.52`. The pairing claims: *this MCC tarball passed the full Playwright E2E on a throwaway box running that openclaw version*.

**The prefix is sticky. The suffix is free.**

- **Bumping the MCC suffix** (`2026.6.1-v0.3.52` → `2026.6.1-v0.3.53`): no E2E required. The openclaw pairing isn't changing, the prior validation still stands for that openclaw version. `build-release.mjs` defaults the prefix from `release-manifest.json`'s `latest.openclawVersion`, so a normal `npm run build:release` just reuses it.
- **Bumping the openclaw prefix** (`2026.6.1-v0.3.x` → `2026.6.2-v0.3.x`): **requires a fresh throwaway E2E pass** against that openclaw version. Set `MCC_OPENCLAW_VERSION=2026.6.2` to claim the new pairing — the env override is the operator's "I just validated this" attestation. Don't set it without running E2E.

`build-release.mjs` resolution precedence:
1. `MCC_OPENCLAW_VERSION` env override (use only after E2E pass on the new openclaw)
2. `release-manifest.json` → `latest.openclawVersion` (sticky from prior validated release)
3. Local `openclaw --version` (first-time setup before any manifest exists)
4. Unpaired — display falls back to `v0.3.52`

Build output prints the source so you can see which path won.

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

## Decide the openclaw pairing (step 5)

Before building, ask: **am I bumping the openclaw prefix this release, or just the MCC suffix?**

- **MCC-only patch** (the common case — bug fix, small feature, reusing the prior validated openclaw): nothing to do. Just `npm run build:release`. The prefix sticks to whatever `release-manifest.json` last validated.
- **Openclaw prefix bump** (you want this release tagged with a newer openclaw): you MUST run a fresh throwaway E2E against that openclaw first. Set `MCC_OPENCLAW_VERSION=<new>` only after the suite is green.

To check what openclaw version the throwaway is running (helps decide):

```bash
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version'
# → OpenClaw 2026.6.1 (sha)
```

## Build the tarball (step 6)

For an MCC-only patch (most cases):

```bash
npm run build:release
```

For a prefix bump (after fresh E2E pass on the new openclaw):

```bash
MCC_OPENCLAW_VERSION=2026.6.2 npm run build:release
```

Takes 20–40 s. Produces `dist/mission-control-vX.Y.Z-linux-x64.tar.gz` (~25 MB) plus the install scripts. Pipeline lives in `scripts/build-release.mjs`. The build output prints the resolved openclaw source — verify it matches your intent before proceeding.

Verify the bake:

```bash
tar xzOf dist/mission-control-v*-linux-x64.tar.gz ./version.json
# { "version": "2026.6.1-v0.X.Y", "mccVersion": "0.X.Y", "openclawVersion": "2026.6.1", ... }
```

## Validate on throwaway (step 7) — required ONLY for openclaw prefix bumps

**When the prefix is unchanged from the prior release**, the existing pairing claim still holds — the throwaway has been validated for that openclaw version, and a logic-only MCC change inherits that validation. **Skip this step.**

**When you're bumping the openclaw prefix**, this step is what gives the new pairing its meaning. Don't publish past a red E2E — the new paired tag would be a lie.

```bash
# 1. Push the tarball + upgrade the throwaway in place
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'

# 2. Wait for the new version to come up healthy
NEW_MCC="$(node -p 'require("./package.json").version')"
until curl -s --max-time 5 http://$E2E_SSH_HOST:3737/api/health | grep -q "\"mccVersion\":\"$NEW_MCC\""; do sleep 5; done
curl -s http://$E2E_SSH_HOST:3737/api/health

# 3. Full Playwright E2E
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e
```

**Pass criteria:** all tests green, or only known-upstream failures (flag those to the user before proceeding).

If E2E fails:
- Logic bug → fix in MCC, rebuild, re-upgrade, re-run.
- Spec is environment-flaky → fix the spec to be idempotent. Don't waive.
- Upstream openclaw bug → either pin to the prior openclaw (drop the env override, rebuild) or note as known-issue in release notes.

## Publish (steps 8–9)

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

## Restart the dev server (step 10)

```bash
systemctl --user start mission-control
```

## Verify (step 11)

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

### MCC-only patch (common case — pairing inherited from prior release)

```bash
git status && git branch --show-current
npm version patch
git push --follow-tags
systemctl --user stop mission-control
npm run build:release                          # prefix sticks from manifest
MCC_NOTES="- …" npm run publish:release        # MCC_NOTES optional
systemctl --user start mission-control
curl -sL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json | head -30
```

### Openclaw prefix bump (rare — requires E2E validation)

```bash
# 1. Pre-flight + bump
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. Build paired with the NEW openclaw on the throwaway
systemctl --user stop mission-control
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
OC_VER="$(ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version' | sed -En 's/OpenClaw ([0-9.]+).*/\1/p')"
MCC_OPENCLAW_VERSION="$OC_VER" npm run build:release

# 3. Validate on throwaway — REQUIRED for the new pairing claim
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e

# 4. Only after E2E green: publish + restart
MCC_NOTES="- …" npm run publish:release
systemctl --user start mission-control
curl -sL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json | head -30
```
