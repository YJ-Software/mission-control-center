---
name: e2e-test
description: Run the Mission Control E2E test against the TWNoC throwaway VPS. Use this skill whenever the user says "跑 e2e 全測", "fresh test", "rebuild test 環境", "執行 e2e 測試", "驗證新版本上 throwaway 跑得起來", or any intent to verify a clean install of OpenClaw + MCC end-to-end.
---

# Run the TWNoC E2E test

This skill runs an automated end-to-end test that:
1. Rebuilds the throwaway VPS via Virtualizor enduser API (`act=ostemplate`,
   injects saved SSH key by panel ID, sets a fixed root password from
   `E2E_REBUILD_PASSWORD`).
2. Drives the WHMCS deployer (Playwright) to install OpenClaw + MCC.
   Picks the "已變更" SSH-password branch and supplies
   `E2E_REBUILD_PASSWORD`.
3. Locks the VPS firewall (ufw) to operator IP + WHMCS deployer IP
   (`202.12.76.145`) + a legacy `122.146.90.137` slot. Source IP is read
   from `$SSH_CONNECTION`, not `who`.
4. Runs the MCC functional Playwright suite (12 specs, ~4 min).
5. Triggers a **second** WHMCS deploy (one-shot SSH-session pairing form
   lives on `deploying.php`, can't be reused across Playwright sessions)
   then pairs Telegram via gramjs MTProto on that fresh `deploying.php`.

The procedure is **rigid**. Each phase mutates real infrastructure — don't
reorder or skip.

## Pre-flight

Confirm before running:

1. **`.env.e2e.local` is filled in.** Run `grep -nE '^[A-Z_]+=$' .env.e2e.local` —
   list any empty-valued keys and stop if anything required is missing.
   Required keys: `TG_API_ID TG_API_HASH TG_USER_SESSION E2E_SSH_HOST
   E2E_SSH_USER E2E_SSH_KEY E2E_LOCAL_PUBLIC_IP E2E_REBUILD_PASSWORD
   VIRTUALIZOR_* WHMCS_* TEST_TELEGRAM_BOT_TOKEN TEST_BOT_USERNAME`.
2. **`E2E_REBUILD_PASSWORD` set to a fixed value.** Without it the
   `rebuildVps()` helper generates a random one and throws it away —
   then Phase 2's deploy spec can't fill the "已變更" SSH-password
   textbox. Pick any 20+ char string and keep it stable.
3. **gramjs auth done.** Check `TG_USER_SESSION` is non-empty. If empty:
   tell the user to run `npm run e2e:auth-telegram` interactively
   first (one-time).
4. **Operator's public IP unchanged.** Run `curl -s https://ifconfig.me`
   and compare to `E2E_LOCAL_PUBLIC_IP`. Mismatch → tell the user to
   update or Phase 3 will lock them out (it self-checks via
   `$SSH_CONNECTION` and refuses to enable ufw on mismatch).
5. **Playwright browsers installed.** Need *both* `chromium-*` and
   `chromium_headless_shell-*` in `~/.cache/ms-playwright/` matching
   the current playwright version. If anything missing,
   `npx playwright install chromium`.
6. **Local outbound TCP/3737 is allowed.** Phase 3 post-check and Phase 4
   specs both connect from this machine to `<E2E_SSH_HOST>:3737`. On a
   strict-OUTPUT host (Moni's dev box does this) the port is blocked by
   default — Phase 3 will report `status=0` and Phase 4 will hang.
   Add a targeted rule before running:
   ```
   sudo iptables -I LOCALOUTPUT 1 -p tcp --dport 3737 -j ACCEPT
   ```
   Remove after the run if you want clean state:
   ```
   sudo iptables -D LOCALOUTPUT -p tcp --dport 3737 -j ACCEPT
   ```

## Modes

Ask the user which mode unless obvious from their request.

- **`full`** (default for "跑全測"): all 5 phases. Real time is
  **~25–35 minutes** (rebuild ~6–8 min, deploy ~5 min, firewall ~30s,
  specs ~4 min, telegram ~2 min since it triggers its own deploy).
- **`smoke`** (for "只跑 specs", "不要重灌"): just `mcc` Playwright
  project against the existing dashboard.
- **`firewall-only`** (for "我換家網路了，重設 ufw"): re-run only Phase 3.
- **`full --from=<phase>`** (for "我剛跑了 rebuild, 接著從 deploy 跑"):
  skip phases before `<phase>`. Valid: `rebuild | deploy | firewall |
  specs | telegram`. Saves reinstall quota when iterating on later
  phases.

## Run

```bash
npm run test:e2e:full          # all phases, no pauses
npm run test:e2e:full:dry      # all phases, prompts Enter between each (interactive)
npm run test:e2e:smoke         # only the mcc spec project
npm run test:e2e:firewall      # only Phase 3 (ufw)

# Resume mode — kick off the orchestrator skipping done phases
node scripts/e2e/twnoc/run-e2e.mjs full --from=deploy
```

Background the run when you don't want to block the chat:
```
npm run test:e2e:full &
```
…and watch `tail -F` on the output file with a filter for phase
boundaries + pass/fail.

## After Phase 5

Phase 5 (telegram pair) triggers its own deploy because the WHMCS
`deploying.php` SSH session is one-shot and Phase 2 already consumed
its window. Before that second deploy, the spec walks the deploy-list
and visits any leftover `deploying.php?id=…` rows to ack them — WHMCS
otherwise refuses `新增部署` with "已有一個部署正在進行中".

## Failure Handling

If any phase fails:
- The orchestrator stops, prints the failing phase, writes
  `test-results/last-run/phase-<n>.json` with the error.
- Read that record + `troubleshooting.md` before retrying.
- Playwright phases also dump screenshots / videos / traces under
  `test-results/output/<spec-id>/`.

## Idempotency

`full` always rebuilds from scratch — never trust prior state.
`smoke`, `firewall-only`, and `full --from=<phase>` are safe to repeat.
Re-running a failed phase: prefer `--from=<phase>` over `full` so you
don't burn another Virtualizor reinstall quota (default is 5/month).

## After a successful run

- The dashboard is live at `http://$E2E_SSH_HOST:3737`, firewalled to
  operator + 202.12.76.145 + 122.146.90.137.
- `AUTH_PASSWORD` is fresh in `.env.e2e.local` for ad-hoc Playwright
  runs against this VPS.
- Telegram pairing is complete; the test bot (`@janeauto_bot` or
  whatever `TEST_BOT_USERNAME` resolves to) is talking to the dashboard.

If the user wants to inspect the dashboard, share the URL + the new
`AUTH_PASSWORD`. They can SSH in for logs at
`~/.mission-control/logs/mission-control.log`.
