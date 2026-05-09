import { test, expect } from '@playwright/test'

const PAGES = ['/dashboard', '/cron-jobs', '/agents', '/setup', '/sessions']

for (const path of PAGES) {
  test(`page renders: ${path}`, async ({ page, baseURL }) => {
    const consoleErrors: string[] = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    const resp = await page.goto(`${baseURL}${path}`)
    expect(resp?.status(), `HTTP status for ${path}`).toBeLessThan(500)
    await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 10_000 })
    const fatal = consoleErrors.filter(e => !/DevTools|favicon|hydrat/i.test(e))
    expect(fatal, `console errors on ${path}`).toHaveLength(0)
  })
}
