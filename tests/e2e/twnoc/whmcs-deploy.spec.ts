import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { updateEnvFile } from '../../../scripts/e2e/twnoc/lib/env-writer.mjs'
import { ackLeftoverDeploys } from '../../../scripts/e2e/twnoc/lib/whmcs-deploy-list.mjs'

// 20 min, not 10. OpenClaw 2026.7.1 added a 5-minute startup-migration lease that
// the deployer's start→restart sequence strands, so the gateway sits failed until
// the lease expires and the playbook's self-healing wait restarts it. Measured
// 2026-07-16: gateway first start 14:40:04, recovered 14:45:44 — 5m40s of the
// deploy budget spent before MCC even begins installing.
const DEPLOY_TIMEOUT = 20 * 60 * 1000

test('whmcs deploy → capture AUTH_PASSWORD', async ({ page }) => {
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

  // Capture AUTH_PASSWORD from #mcc-auth-password input
  await expect(page.locator('#mcc-auth-password')).toBeVisible()
  await expect(async () => {
    const v = await page.locator('#mcc-auth-password').inputValue()
    expect(v.length).toBeGreaterThan(0)
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] })
  const password = await page.locator('#mcc-auth-password').inputValue()

  // Persist screenshot for the run record
  const dir = resolve(process.cwd(), 'test-results/last-run')
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, 'phase-2-success.png'), fullPage: true })

  // Write AUTH_PASSWORD into the dynamic block
  const envPath = resolve(process.cwd(), '.env.e2e.local')
  updateEnvFile(envPath, { AUTH_PASSWORD: password })

  writeFileSync(resolve(dir, 'phase-2.json'), JSON.stringify({
    phase: 2,
    ts: new Date().toISOString(),
    ok: true,
    auth_password_len: password.length,
  }, null, 2))
})
