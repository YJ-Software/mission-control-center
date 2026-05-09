import { test, expect } from './fixtures/login'

const INSTALL_TIMEOUT = 5 * 60 * 1000

test('search setup: install flow', async ({ loggedInPage: page, baseURL }) => {
  await page.goto(`${baseURL}/setup`)
  await page.getByRole('tab', { name: /搜尋|Search|Tavily/i }).click()

  const notInstalled = page.getByText(/尚未安裝|Not\s*Installed/i)
  if (await notInstalled.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole('button', { name: /一鍵安裝|Install/i }).click()
    await expect(notInstalled).not.toBeVisible({ timeout: INSTALL_TIMEOUT })
  }
  await expect(notInstalled).not.toBeVisible({ timeout: 5_000 })
})
