# Tests

Two layers:

- **`tests/unit/`** — [Vitest](https://vitest.dev) unit tests. Pure logic only,
  mock out fs / child_process / network. Runs in ~1s, safe on any machine.
- **`tests/e2e/`** — [Playwright](https://playwright.dev) browser tests that
  hit real API endpoints and watch real install flows. Expect a clean
  throwaway environment (VPS / container) — they mutate system state
  (apt installs, dpkg, systemd units).

## E2E is the gate for recording a validated backend version

Version numbers are plain MCC semver (`v0.3.93`) — no openclaw prefix. Instead, `release-manifest.json`'s `latest.validated` records which backend versions the release's E2E actually ran against, e.g. `{ "openclaw": ["2026.9.3"] }`. The E2E suite is what makes that claim true: *this MCC tarball passed the full E2E against that backend version on a throwaway box*.

The gate applies to **recording a newly validated backend version**, not every release. An MCC-only change doesn't need one.

- **MCC patch / fix release** (no new backend version to validate): no E2E rerun required. The existing validated list still holds — the prior release already validated MCC against those backend versions, and a logic-only MCC change inherits that validation. `publish-release.mjs` automatically reuses the previous entry's `validated` list from `release-manifest.json` at publish time when `MCC_VALIDATED_OPENCLAW` / `MCC_VALIDATED_HERMES` are unset.
- **Recording a newly validated backend version** (e.g. openclaw 2026.6.1 → 2026.6.2): full E2E **required** before publish. Set `MCC_VALIDATED_OPENCLAW=<new>` only after the throwaway pass — the env var is the operator's attestation.

Workflow for recording a newly validated backend version:

1. Throwaway must be running the target openclaw version.
2. `npm run build:release` — builds the tarball (no backend-version env var needed at build time).
3. scp the tarball + run `install/upgrade.sh` on the throwaway. Wait for `/api/health` to come up at the new version.
4. `npm run test:e2e` against the throwaway.
5. **Only after the suite is green** → `MCC_VALIDATED_OPENCLAW=<version the run used> npm run publish:release`.

If a test fails, fix it (MCC or spec) and rebuild. Never record a validated version past a red E2E — the `validated` entry would be a lie. Full procedure with copy-paste commands lives in `.claude/skills/release/SKILL.md`.

## Quick commands

```bash
# Unit (safe, always)
npm test
npm run test:watch

# E2E (requires throwaway env — never run against production)
npx playwright install chromium                     # first run only
PLAYWRIGHT_BASE_URL=http://<host>:3737 \
  AUTH_PASSWORD=<dashboard-password> \
  npm run test:e2e
```

## What each unit test covers

| File | What it proves |
|------|----------------|
| `opencli-extension-url.test.ts` | GitHub releases API parsing finds `opencli-extension*.zip` even when upstream renames with a version suffix (regression from commit a38a4ae). |
| `obsidian-locale.test.ts` | `setObsidianLocale` rewrites `--lang=` in the systemd unit, appends when missing, rejects shell-injection locales, is idempotent. |
| `podcast-script.test.ts` | Markdown podcast-script parser splits `## 開場白 / 轉場 / 結語` correctly, handles missing sections. |

Add a new unit test when you fix a pure-logic bug — the test itself is the regression guard.

## What the E2E test covers

`setup-imunifyav.spec.ts` — full lifecycle on a fresh VM:

1. Login with `AUTH_PASSWORD`.
2. Navigate to `/setup` → 防毒軟體 tab.
3. Click 一鍵安裝, wait up to 5 min for the install SSE stream to finish.
4. Verify UI shows 「服務狀態」 + version 8.x.y.
5. Click 完整移除 (two-step confirm), wait for purge to finish.
6. Verify UI returns to 「尚未安裝」.
7. Click 一鍵安裝 again — idempotency check.

### Extending E2E

Add one `*.spec.ts` file per setup flow (NotebookLM, Tavily search, browser,
obsidian, morning report, backup). Each should follow the same install →
verify → uninstall → verify pattern. Give each a generous per-step
timeout — apt is slow, network downloads are slow, first-time installs
legitimately take 2–5 minutes.

## Full E2E run on TWNoC throwaway

Beyond the per-flow specs above, there's a one-command full E2E that
rebuilds a Virtualizor VPS, drives the WHMCS deployer, locks the
firewall, and runs the entire `mcc` suite. Plus Telegram pairing via
gramjs.

Prereqs:
1. Copy `.env.e2e.local.example` → `.env.e2e.local`, fill in.
2. `npm run e2e:auth-telegram` (one-time, captures `TG_USER_SESSION`).

Common commands:

```bash
npm run test:e2e:full:dry       # full run, paused between phases
npm run test:e2e:full           # full unattended
npm run test:e2e:smoke          # just the mcc project against current dashboard
npm run test:e2e:firewall       # re-apply ufw rules (e.g. after IP change)
```

Per-phase records land in `test-results/last-run/phase-N.json`.
Failure modes: see `.claude/skills/e2e-test/troubleshooting.md`.
