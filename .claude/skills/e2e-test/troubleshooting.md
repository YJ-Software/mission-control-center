# E2E Test — Troubleshooting

Read `test-results/last-run/phase-<n>.json` for the failing phase first.

## Phase 1: rebuild VPS

**`401 Unauthorized` from Virtualizor**
- API key/pass mismatch. Re-check `VIRTUALIZOR_API_KEY` / `VIRTUALIZOR_API_PASS`.
- Some panels IP-allowlist API access. Confirm `E2E_LOCAL_PUBLIC_IP` is allowed in vps.twnoc.net's API settings.

**Rebuild API returns OK but `waitForRunning` times out**
- Check Virtualizor panel manually — VPS might have stuck on a console prompt.
- Wrong `VIRTUALIZOR_OS_TEMPLATE_ID` for this VPS plan (some templates are not allowed). Try a different OS in the panel UI to confirm a working template ID.

**SSH never comes up after rebuild**
- moniDev key not attached to the VPS. Check vps.twnoc.net → VPS → SSH Keys.
- Some Virtualizor templates inject the key into a non-root user. SSH as `ubuntu` instead of `root` if that's the template default — adjust `E2E_SSH_USER`.

## Phase 2: WHMCS deploy

**Login fails**
- Password rotated → update `.env.e2e.local`.
- CAPTCHA / 2FA → run `HEADED=1 npm run test:e2e:deploy` once, solve by hand. Playwright persists `tests/e2e/storage/whmcs-state.json` so subsequent headless runs reuse the session.

**`.label-success` never appears**
- Backend deploy stuck. Check `https://twnoc.net/whmcs/...` manually for status.
- Increase `DEPLOY_TIMEOUT` in `whmcs-deploy.spec.ts` if installs legitimately take >10 min on slow plans.

**`#mcc-auth-password` is empty**
- Deployer didn't write the password yet. The spec polls for non-empty value with `toPass`; if it's empty for 30s, deploy hasn't fully finalized — investigate WHMCS-side logs.

## Phase 3: ufw

**`source IP mismatch: who reports X but E2E_LOCAL_PUBLIC_IP=Y`**
- Operator's home/office IP changed (ISP rotation, new location). Run `curl ifconfig.me` and update `E2E_LOCAL_PUBLIC_IP`.

**Locked out (Phase 4 can't reach the dashboard)**
- Use Virtualizor panel → VNC console → login as root → `ufw disable`. Then fix `E2E_LOCAL_PUBLIC_IP` and re-run `npm run test:e2e:firewall`.

## Phase 4: MCC specs

**Login spec fails**
- `AUTH_PASSWORD` not set or stale. Re-run `npm run test:e2e:deploy` to refresh.

**Setup tab spec fails after install**
- Different setup tab UI than the spec assumes. Run `HEADED=1 npx playwright test --project=mcc setup-<tab>` and adjust selectors in the spec.

## Telegram pair

**`No reply from @<bot> within 60s`**
- Bot not configured by the dashboard yet (deploy hadn't fully wired the token). Add a longer `await page.waitForTimeout(...)` after 設定 before calling gramjs.
- Test bot revoked / token rotated → regenerate token, update `TEST_TELEGRAM_BOT_TOKEN`.

**`unexpected reply: …`**
- Bot reply format changed. Update the regex in `whmcs-telegram-pair.spec.ts` to match. Capture the actual reply via `console.log` first.

**MTProto auth expired**
- Telegram revoked the session (very rare). Re-run `npm run e2e:auth-telegram` to mint a new `TG_USER_SESSION`.
