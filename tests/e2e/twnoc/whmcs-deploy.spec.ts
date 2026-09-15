import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { updateEnvFile } from '../../../scripts/e2e/twnoc/lib/env-writer.mjs'
import { ackLeftoverDeploys } from '../../../scripts/e2e/twnoc/lib/whmcs-deploy-list.mjs'
import { sshExec } from '../../../scripts/e2e/twnoc/lib/ssh.mjs'

// 20 min, not 10. OpenClaw 2026.7.1 added a 5-minute startup-migration lease that
// the deployer's start→restart sequence strands, so the gateway sits failed until
// the lease expires and the playbook's self-healing wait restarts it. Measured
// 2026-07-16: gateway first start 14:40:04, recovered 14:45:44 — 5m40s of the
// deploy budget spent before MCC even begins installing.
const DEPLOY_TIMEOUT = 20 * 60 * 1000

/** A chat turn through /talk: the model reply is the slow part. */
const TALK_REPLY_TIMEOUT = 3 * 60 * 1000

/**
 * The deployer's MCC panel used to print the dashboard password in
 * #mcc-auth-password. The broker-based "開啟任務管制中心" button needs no
 * password, so a deploy page may no longer carry it — later phases still log in
 * with it, so fall back to reading it off the box.
 */
async function readAuthPasswordFromBox(): Promise<string> {
  const { E2E_SSH_USER: user, E2E_SSH_HOST: host, E2E_SSH_KEY: keyPath } = process.env
  if (!user || !host || !keyPath) throw new Error('set E2E_SSH_USER / E2E_SSH_HOST / E2E_SSH_KEY to read AUTH_PASSWORD from the box')
  const { code, stdout, stderr } = await sshExec({
    user,
    host,
    keyPath,
    command: "sudo -n cat /home/openclaw/.mission-control/.env.local 2>/dev/null || cat /home/openclaw/.mission-control/.env.local",
  })
  const line = stdout.split('\n').find((l: string) => l.startsWith('AUTH_PASSWORD='))
  const value = line?.slice('AUTH_PASSWORD='.length).trim().replace(/^['"]|['"]$/g, '')
  if (code !== 0 || !value) throw new Error(`AUTH_PASSWORD not found on ${host} (ssh exit ${code}): ${stderr.trim().slice(0, 200)}`)
  return value
}

test('whmcs deploy → capture AUTH_PASSWORD → open /talk from the deploy page and chat', async ({ page }) => {
  const user = process.env.WHMCS_USER
  const pwd = process.env.WHMCS_PASSWORD
  const loginUrl = process.env.WHMCS_LOGIN_URL
  const rebuildPwd = process.env.E2E_REBUILD_PASSWORD
  test.skip(!user || !pwd || !loginUrl, 'set WHMCS_USER / WHMCS_PASSWORD / WHMCS_LOGIN_URL')

  // Auto-accept the 開始部署 confirm dialog
  page.on('dialog', d => { d.accept().catch(() => {}) })

  // Login
  await page.goto(loginUrl!)
  await page.getByRole('textbox', { name: /Email/i }).fill(user!)
  await page.getByRole('textbox', { name: /密碼|Password/i }).fill(pwd!)
  await page.getByRole('button', { name: /登入|Log\s*In/i }).click()
  await page.waitForLoadState('networkidle')

  // Navigate to deployer
  await page.getByRole('button', { name: /檢視詳情/ }).first().click()
  await page.getByRole('link', { name: /OpenClaw 部署/ }).click()

  // A deploy left 執行中 by an earlier run (ours or a previous release) makes
  // WHMCS refuse 新增部署, so the form below never renders. Clear leftovers in
  // this browser context first.
  await ackLeftoverDeploys(page)

  await page.getByRole('button', { name: /新增部署/ }).click()

  // Phase 1 reinstall set a new root password (E2E_REBUILD_PASSWORD). Tell the
  // deployer about it by selecting "已變更" and filling the password box; the
  // default "未變更 (開通)" path expects the original provisioning password,
  // which we no longer have after our Virtualizor API reinstall.
  if (rebuildPwd) {
    await page.getByRole('radio', { name: /已變更/ }).check()
    await page.getByRole('textbox', { name: /SSH 密碼/ }).fill(rebuildPwd)
  }

  await page.getByRole('button', { name: /開始部署/ }).click()

  // Wait for success
  await expect(page.locator('.label-success').filter({ hasText: '成功' })).toBeVisible({
    timeout: DEPLOY_TIMEOUT,
  })

  // Capture AUTH_PASSWORD: from the deploy page when it still prints it,
  // otherwise from the box itself.
  let password = ''
  let passwordSource = 'deploy-page'
  try {
    await expect(async () => {
      const v = await page.locator('#mcc-auth-password').inputValue({ timeout: 2_000 })
      expect(v.length).toBeGreaterThan(0)
    }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 5_000] })
    password = await page.locator('#mcc-auth-password').inputValue()
  } catch {
    passwordSource = 'box'
    password = await readAuthPasswordFromBox()
  }

  // Persist screenshot for the run record
  const dir = resolve(process.cwd(), 'test-results/last-run')
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, 'phase-2-success.png'), fullPage: true })

  // Write AUTH_PASSWORD into the dynamic block
  const envPath = resolve(process.cwd(), '.env.e2e.local')
  updateEnvFile(envPath, { AUTH_PASSWORD: password })

  // ── Open /talk the way a customer does: the deploy page's MCC button ──────
  // It opens the deployer's broker (mcc.open-claw.tw) in a new tab, which signs
  // the browser in and lands on /talk — no SSH tunnel, no password.
  const openMcc = page.getByRole('link', { name: /開啟任務管制中心/ })
  await expect(openMcc).toBeVisible({ timeout: 60_000 })

  // Right after the deploy flips to 成功 the broker can still answer
  // 「這個服務尚未完成部署」 while its registration lands; retry briefly.
  let talk = null as import('@playwright/test').Page | null
  for (let attempt = 1; attempt <= 6 && !talk; attempt++) {
    const [tab] = await Promise.all([page.context().waitForEvent('page'), openMcc.click()])
    await tab.waitForLoadState('domcontentloaded')
    const notReady = await tab.getByText(/尚未完成部署/).isVisible({ timeout: 5_000 }).catch(() => false)
    if (!notReady) {
      talk = tab
      break
    }
    await tab.close()
    await page.waitForTimeout(20_000)
  }
  if (!talk) throw new Error('broker kept answering 「這個服務尚未完成部署」 after the deploy succeeded')

  await expect(talk).toHaveURL(/\/talk(?:[/?#]|$)/, { timeout: 90_000 })
  const composer = talk.locator('textarea').first()
  await expect(composer).toBeVisible({ timeout: 60_000 })

  // Count first: /talk restores history, so only a NEW reply proves the chat works.
  const assistant = talk.locator('[data-role="assistant"]')
  const before = await assistant.count()
  await composer.fill('回我一個 OK')
  await composer.press('Enter')
  await expect(assistant).not.toHaveCount(before, { timeout: TALK_REPLY_TIMEOUT })
  await expect(async () => {
    expect((await assistant.last().innerText()).trim().length).toBeGreaterThan(0)
  }).toPass({ timeout: TALK_REPLY_TIMEOUT, intervals: [1_000, 2_000, 5_000] })
  await talk.screenshot({ path: resolve(dir, 'phase-2-talk.png') })

  // The broker URL carries a signed one-time token; record where we landed, not how.
  const landed = new URL(talk.url())
  writeFileSync(resolve(dir, 'phase-2.json'), JSON.stringify({
    phase: 2,
    ts: new Date().toISOString(),
    ok: true,
    auth_password_len: password.length,
    auth_password_source: passwordSource,
    talk: { origin: landed.origin, path: landed.pathname, replied: true },
  }, null, 2))
})
