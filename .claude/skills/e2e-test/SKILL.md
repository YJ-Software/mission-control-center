---
name: e2e-test
description: Run the Mission Control E2E test against the TWNoC throwaway VPS. Use this skill whenever the user says "跑 e2e 全測", "fresh test", "rebuild test 環境", "執行 e2e 測試", "驗證新版本上 throwaway 跑得起來", or any intent to verify a clean install of OpenClaw + MCC end-to-end.
---

# Run the TWNoC E2E test

This skill runs an automated end-to-end test that:
1. Rebuilds the throwaway VPS via Virtualizor enduser API.
2. Drives the WHMCS deployer (Playwright) to install OpenClaw + MCC.
3. Locks the VPS firewall (ufw) to operator IP + 122.146.90.137.
4. Runs the MCC functional Playwright suite.
5. Pairs Telegram via gramjs MTProto.

The procedure is **rigid**. Each phase mutates real infrastructure — don't reorder or skip.

## Pre-flight

Confirm before running:

1. **`.env.e2e.local` is filled in.** Run `grep -c '=$' .env.e2e.local` — if any key is empty, list them and stop. The keys with empty `=` lines are missing values.
2. **gramjs auth done.** Check `TG_USER_SESSION` is non-empty in `.env.e2e.local`. If empty: tell the user to run `npm run e2e:auth-telegram` interactively first (one-time).
3. **Operator's public IP unchanged.** Run `curl -s ifconfig.me` and compare to `E2E_LOCAL_PUBLIC_IP` in `.env.e2e.local`. Mismatch → tell the user to update before running, or Phase 3 will lock them out.
4. **Playwright browsers installed.** If `~/.cache/ms-playwright/chromium-*` doesn't exist, `npx playwright install chromium`.

## Modes

Ask the user which mode unless obvious from their request:

- **`full`** (default for "跑全測"): all 5 phases. Takes 15–25 minutes.
- **`smoke`** (for "只跑 specs", "不要重灌"): just `mcc` Playwright project against the existing dashboard.
- **`firewall-only`** (for "我換家網路了，重設 ufw"): re-run only Phase 3.

## Run

For `full` (or first run): start with dry-run.

```bash
npm run test:e2e:full:dry
```

The script pauses between phases. Operator presses Enter to continue. After a successful dry-run, subsequent runs use `npm run test:e2e:full` (no pauses).

For `smoke`:

```bash
npm run test:e2e:smoke
```

For `firewall-only`:

```bash
npm run test:e2e:firewall
```

## Failure Handling

If any phase fails:
- The orchestrator stops, prints the failing phase, and writes `test-results/last-run/phase-<n>.json` with the error.
- Do NOT retry blindly. Read the failure record + `troubleshooting.md`.
- Phases 2 and onward also dump screenshots to `test-results/output/` (Playwright defaults).

## Idempotency

`full` always rebuilds from scratch — never trust prior state. `smoke` and `firewall-only` are safe to repeat.

## After a successful run

- The dashboard remains live at `http://$E2E_SSH_HOST:3737`, firewalled to operator + 122.146.90.137.
- `AUTH_PASSWORD` is fresh in `.env.e2e.local` for ad-hoc Playwright runs.
- Telegram pairing is complete; the test bot is talking to the dashboard.

If the user wants to inspect the dashboard, share the URL + the new `AUTH_PASSWORD`. They can ssh in for logs at `~/.mission-control/logs/mission-control.log`.
