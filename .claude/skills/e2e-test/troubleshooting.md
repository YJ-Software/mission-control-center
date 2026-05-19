# E2E Test — Troubleshooting

Read `test-results/last-run/phase-<n>.json` for the failing phase first.
For Playwright failures, also read
`test-results/output/<spec-id>/error-context.md` — it captures the
page snapshot at the moment of failure.

## Phase 1: rebuild VPS

**`401 Unauthorized` from Virtualizor**
- API key/pass mismatch. Re-check `VIRTUALIZOR_API_KEY` /
  `VIRTUALIZOR_API_PASS`.
- Some panels IP-allowlist API access. Confirm `E2E_LOCAL_PUBLIC_IP` is
  allowed in vps.twnoc.net's API settings.

**API response includes `act:"rebuild"` but nothing actually rebuilds**
- This is the *wrong* endpoint — `act=rebuild` is admin API and our
  enduser key doesn't trigger it. We use `act=ostemplate` POSTed as
  form body. If the response body shows the user preferences/distros
  payload with a `done:{msg:"OS reinstall process has been started"}`,
  the request succeeded. If `done` is missing, the call didn't trigger.

**Rebuild succeeded but `waitForSsh` times out**
- Default timeout is 15 min (was 5 min originally — bumped because
  twnoc cloud-init can take 4–6 min). If consistently flaking past 15
  min, check the Virtualizor panel directly for VPS state.
- Wrong `VIRTUALIZOR_OS_TEMPLATE_ID` for this VPS plan (some templates
  are not allowed). Try a different OS in the panel UI to confirm a
  working template ID.

**SSH connects but key auth is rejected after rebuild**
- moniDev key not attached to the VPS, or rebuild didn't include it.
  `rebuildVps()` looks up `info.ssh_keys` from the panel's
  `act=ostemplate` form-data response and uses the first key's `keyid`
  as `rebuild_sshkey`. If `ssh_keys` is empty, log into
  vps.twnoc.net → SSH Keys and add the operator's public key (the
  panel only shows the keyid + name, not contents).
- Some Virtualizor templates inject the key into a non-root user.
  SSH as `ubuntu` instead of `root` if that's the template default —
  adjust `E2E_SSH_USER`.

**"Host key has changed" warnings, refusing to connect**
- `lib/ssh.mjs` already pins `UserKnownHostsFile=/dev/null` +
  `StrictHostKeyChecking=no` — host key change is expected on each
  reinstall. If you see this warning, you're running ssh manually with
  default options outside the script's `buildSshArgs`. Add the same
  flags or just drop the stale entry: `ssh-keygen -R <host>`.

## Phase 2: WHMCS deploy

**Login fails**
- Password rotated → update `.env.e2e.local`.
- CAPTCHA / 2FA → run `HEADED=1 npm run test:e2e:deploy` once, solve by
  hand. Playwright persists `tests/e2e/storage/whmcs-state.json` so
  subsequent headless runs reuse the session.

**`.label-success` never appears / Ansible fails with `Permission denied`**
- The deploy spec must select the "已變更" radio and fill
  `E2E_REBUILD_PASSWORD`. Phase 1's reinstall set a new root
  password — WHMCS deployer's Ansible can't SSH in with the old
  provisioning password. Confirm `E2E_REBUILD_PASSWORD` is set in
  `.env.e2e.local` so the radio path runs.

**`.label-success` never appears / Ansible fails with `Connection timed
out` to port 22**
- WHMCS deployer IP isn't whitelisted by ufw. Phase 3 must allow
  `202.12.76.145` (the verified deployer IP) for redeploys to work.
  Check `scripts/e2e/twnoc/setup-firewall.mjs`'s `ALWAYS_ALLOW` list.

**`#mcc-auth-password` is empty**
- Deployer didn't write the password yet. The spec polls for non-empty
  value with `toPass`; if it's empty for 30s, deploy hasn't fully
  finalized — investigate WHMCS-side logs.

## Phase 3: ufw

**`source IP mismatch: SSH_CONNECTION reports X but E2E_LOCAL_PUBLIC_IP=Y`**
- Operator's home/office IP changed (ISP rotation, new location). Run
  `curl https://ifconfig.me` and update `E2E_LOCAL_PUBLIC_IP`. Pre-2.7
  the script parsed `who | head -1` instead of `$SSH_CONNECTION` and
  silently returned empty over non-interactive SSH — that's been fixed.

**`dashboard not reachable from local after ufw enable: status=0`**
- ufw rules look correct but local connection still fails immediately
  with "Connection refused". This is a **local-side** firewall on your
  dev box blocking outbound TCP/3737. The remote VPS is fine.
  Add a targeted rule:
  ```
  sudo iptables -I LOCALOUTPUT 1 -p tcp --dport 3737 -j ACCEPT
  ```
  If your machine doesn't have a strict-OUTPUT firewall, this section
  doesn't apply — investigate ufw further.

**Locked out (Phase 4 can't reach the dashboard)**
- Use Virtualizor panel → VNC console → login as root → `ufw disable`.
  Then fix `E2E_LOCAL_PUBLIC_IP` and re-run `npm run test:e2e:firewall`.

## Phase 4: MCC specs

**Login spec fails**
- `AUTH_PASSWORD` not set or stale. Re-run `npm run test:e2e:deploy` to
  refresh.

**`agents-chat` spec — assistant reply never appears**
- Selector `[data-role="assistant"]` requires v0.2.9+ on the dashboard.
  If VPS is on an older release, upgrade it first
  (`/api/upgrade/apply`).
- If selector is fine but spec genuinely times out: OpenClaw needs a
  working model. Fresh deploys ship Qwen3.5-35B-A3B (Gateway: linked)
  by default. Check `/chat` UI directly to confirm an agent is selected
  and the gateway is online.

**`cron-job` spec — fails finding form fields**
- The form's labels aren't `<label htmlFor>`-linked to inputs, so
  `getByRole('textbox', {name: ...})` doesn't work. Spec uses
  `getByPlaceholder(/例：每日報告/)` etc. — if those placeholders
  change in `src/components/cron/cron-job-form.tsx`, update the spec.

**`cron-job` spec — last run status not 'ok'**
- Cron jobs default to `deliveryMode: 'announce'` + `deliveryChannel:
  'last'`, which errors on fresh installs with no channel history.
  Spec selects "不傳送" in the create dialog to sidestep this. If
  the radio's label changes, the spec breaks.
- API filters `/api/cron/runs?id=…` by job UUID, not name — spec
  fetches `/api/cron` first to look up the UUID.

**`setup-notebooklm` spec — install fails with "Executable already exists"**
- Stale `~/.local/bin/notebooklm-mcp` from a prior incomplete install.
  Fixed in v0.3.3+ (`uv tool install --force`). If you're testing an
  older release, SSH into the VPS as `openclaw` and
  `rm -f ~/.local/bin/notebooklm-mcp` before retrying.

**`setup-imunifyav` spec — fails on idempotency cycle**
- Stateful test assuming fresh install. After Phase 1 reinstall it
  starts clean; if you run `smoke` repeatedly without a rebuild,
  ImunifyAV state from the prior run breaks the "尚未安裝" precondition.

## Phase 5: Telegram pair

**Spec fails finding the deploy-list row link**
- WHMCS DataTables rows have no `<a>` inside — clicking the `<tr>`
  itself navigates via `data-href` JS handler. Spec reads the
  `data-href` attribute and `page.goto()`s directly.

**Spec lands on `deploy-info.php` instead of `deploying.php`**
- The Telegram pair form only renders on `deploying.php`. Once any
  user (incl. Phase 2's deploy spec) visits a deploy's
  `deploying.php`, WHMCS marks it ack'd and the row's `data-href`
  flips to `deploy-info.php`. Spec therefore triggers its **own**
  deploy and stays on `deploying.php` for the entire pairing flow.

**"已有一個部署正在進行中" — '新增部署' refused**
- Phase 2's deploy left its row marked 執行中 in the deploy-list (the
  ack only happens via a `deploying.php` visit, and that doesn't
  propagate across Playwright sessions). Spec actively visits every
  `tr[data-href*="deploying.php"]` row before clicking 新增部署 to
  ack them all. If this loop times out (capped at 5 iterations),
  check the panel manually — could be a genuinely stuck server-side
  deploy.

**"SSH session expired. Please redeploy or revisit the deploy page."**
- You're hitting a `deploying.php` that's already been ack'd or
  closed. Phase 5 must drive the entire pairing flow inside its own
  fresh deploying.php session — don't reuse a prior deploy's URL.

**`No reply from @<bot> within 60s`**
- Bot not configured by the dashboard yet (deploy hadn't fully wired
  the token). Add a longer `await page.waitForTimeout(...)` after
  the 設定 step before calling gramjs.
- Test bot revoked / token rotated → regenerate token, update
  `TEST_TELEGRAM_BOT_TOKEN`.

**`unexpected reply: …`**
- Bot reply format changed. Update the regex in
  `whmcs-telegram-pair.spec.ts` to match. Capture the actual reply
  via `console.log` first.

**MTProto auth expired**
- Telegram revoked the session (very rare). Re-run
  `npm run e2e:auth-telegram` to mint a new `TG_USER_SESSION`.

## Cross-cutting

**Playwright complains about missing browser binary version**
- Playwright was upgraded but `npx playwright install chromium` wasn't
  re-run. Both `chromium-<v>` *and* `chromium_headless_shell-<v>` must
  exist in `~/.cache/ms-playwright/` matching the installed playwright
  version. Re-run `npx playwright install chromium`.

**Test passes in vacuously — finishes too fast and verifies nothing**
- Typically a stale locator that doesn't match the current UI. The
  test silently "succeeds" because the negative assertion is true
  for the missing element. Check by reading the spec's screenshot
  output — if the page is on the wrong screen, the locator chain
  branched wrong.
