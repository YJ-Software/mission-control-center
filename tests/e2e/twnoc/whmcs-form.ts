import { expect, type Page } from '@playwright/test'
import { ackLeftoverDeploys } from '../../../scripts/e2e/twnoc/lib/whmcs-deploy-list.mjs'

export async function openDeployForm(page: Page, app: 'openclaw' | 'hermes' = 'openclaw') {
  const { WHMCS_LOGIN_URL, WHMCS_USER, WHMCS_PASSWORD, E2E_REBUILD_PASSWORD } = process.env

  page.on('dialog', dialog => { dialog.accept().catch(() => {}) })
  await page.goto(WHMCS_LOGIN_URL!)
  await page.getByRole('textbox', { name: /Email/i }).fill(WHMCS_USER!)
  await page.getByRole('textbox', { name: /密碼|Password/i }).fill(WHMCS_PASSWORD!)
  await page.getByRole('button', { name: /登入|Log\s*In/i }).click()
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /檢視詳情/ }).first().click()
  if (app === 'hermes') {
    const host = process.env.E2E_SSH_HOST
    if (!host) throw new Error('Set E2E_SSH_HOST to the WHMCS throwaway')
    await expect(page.getByText(host, { exact: false }).first()).toBeVisible()
  }
  await page.getByRole('link', { name: /OpenClaw 部署/ }).click()
  const deployListUrl = page.url()
  await ackLeftoverDeploys(page)
  const priorHermesDeployIds = app === 'hermes'
    ? await page.locator('tr[data-href*="deploy-info.php"]').filter({ hasText: /hermes/i }).evaluateAll(rows =>
        rows.flatMap(row => {
          const id = new URL(row.getAttribute('data-href')!, location.href).searchParams.get('id')
          return id ? [id] : []
        }))
    : []
  await page.getByRole('button', { name: /新增部署/ }).click()

  if (app === 'hermes') await page.locator('input[type="radio"][value="hermes"]').check()
  if (E2E_REBUILD_PASSWORD) {
    await page.getByRole('radio', { name: /已變更/ }).check()
    await page.getByRole('textbox', { name: /SSH 密碼/ }).fill(E2E_REBUILD_PASSWORD)
  }
  return { deployListUrl, priorHermesDeployIds }
}
