import { randomUUID } from 'node:crypto'
import { test, expect } from '../fixtures/login'
import { expectJobSuccess, native, requireHermes, unitPid } from './target'

test.beforeEach(async ({ request, baseURL }) => requireHermes(request, baseURL))

test('logs in and opens the Hermes home', async ({ loggedInPage: page }) => {
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '任務管制中心' })).toBeVisible()
  await expect(page.getByText('Hermes Mission Control', { exact: true })).toBeVisible()
  await expect(page.getByText('System Health', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sidebar]').getByText(/^HERMES v/)).toBeVisible()
})

test('lists a native Hermes session and opens its detail', async ({ loggedInPage: page }) => {
  const id = `mcc-e2e-sessions-${randomUUID()}`
  const title = `Hermes E2E ${id.slice(-8)}`
  await native('POST', '/api/sessions', 201, { id, title })
  try {
    await page.goto('/sessions')
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
    await page.locator('main span').and(page.getByText(title, { exact: true })).click()
    await expect(page.getByText('Recent Messages', { exact: true })).toBeVisible()
    await expect(page.getByText(id, { exact: true })).toBeVisible()
  } finally {
    await native('DELETE', `/api/sessions/${id}`)
  }
})

test('shows the Hermes cost estimate label', async ({ loggedInPage: page }) => {
  await page.goto('/costs')
  await expect(page.getByRole('heading', { name: '花費分析' })).toBeVisible()
  await expect(page.getByText('依公開 API 牌價估算', { exact: true })).toBeVisible()
})

test('shows and restarts hermes-gateway from Services Status', async ({ loggedInPage: page }) => {
  await page.goto('/dashboard')
  const unit = page.getByText('hermes-gateway.service', { exact: true })
  await expect(unit).toBeVisible()
  await expect(page.getByText('openclaw', { exact: true })).toHaveCount(0)
  const oldPid = await unitPid('hermes-gateway')
  expect(oldPid).toBeGreaterThan(0)
  await page.getByRole('button', { name: '重新啟動', exact: true }).click()
  await expect(page).toHaveURL(/\/system-log\?job=/)
  const jobId = new URL(page.url()).searchParams.get('job')
  expect(jobId).toBeTruthy()
  await expectJobSuccess(page.request, jobId!)
  const newPid = await unitPid('hermes-gateway')
  expect(newPid).toBeGreaterThan(0)
  expect(newPid).not.toBe(oldPid)
  await native('GET', '/health/detailed')
  console.log(`Hermes Services restart PID ${oldPid} → ${newPid}`)
})

test('hides OpenClaw pages in both menus and rejects direct URLs', async ({ loggedInPage: page }) => {
  const paths = [
    '/agents', '/customer-service', '/live-feed', '/cron-jobs', '/morning-report',
    '/second-brain', '/llm-auth', '/setup',
  ]
  const desktop = page.locator('[data-sidebar] nav')
  await expect(desktop.locator('a[href="/sessions"]')).toBeVisible()
  for (const path of paths) await expect(desktop.locator(`a[href="${path}"]`)).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open menu' }).click()
  const mobile = page.getByRole('dialog')
  await expect(mobile.locator('a[href="/sessions"]')).toBeVisible()
  await expect(mobile.getByText(/^HERMES v/i)).toBeVisible({ timeout: 5_000 })
  for (const path of paths) await expect(mobile.locator(`a[href="${path}"]`)).toHaveCount(0)

  for (const path of paths) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.getByRole('status').filter({ hasText: '此後端不支援' })).toBeVisible()
  }
})
