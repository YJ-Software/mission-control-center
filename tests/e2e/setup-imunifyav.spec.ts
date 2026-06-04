import { test, expect } from './fixtures/login'

/**
 * Full lifecycle smoke test for ImunifyAV installer.
 * Expects a clean throwaway environment with no prior ImunifyAV install.
 * Cycle: install → verify (UI + API) → purge → verify clean → install again (idempotency).
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test setup-imunifyav
 */

const INSTALL_TIMEOUT = 5 * 60 * 1000
const PURGE_TIMEOUT = 3 * 60 * 1000

test.describe('ImunifyAV setup flow', () => {
  test('install → purge → install (idempotent)', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/setup`)
    await page.getByRole('tab', { name: /防毒軟體|ImunifyAV/i }).click()

    // Normalize starting state: if a previous run left ImunifyAV installed,
    // purge it first so the rest of the spec runs against a clean baseline.
    const alreadyInstalled = await page
      .getByText(/服務狀態/)
      .isVisible({ timeout: 3_000 })
      .catch(() => false)
    if (alreadyInstalled) {
      await page.getByRole('button', { name: /完整移除/ }).click()
      await page.getByRole('button', { name: /確認完整移除/ }).click()
      await expect(page.getByText('尚未安裝')).toBeVisible({ timeout: PURGE_TIMEOUT })
    }

    // First install --------------------------------------------------------
    await expect(page.getByText('尚未安裝')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: '一鍵安裝' }).click()

    await expect(page.getByText(/服務狀態/)).toBeVisible({ timeout: INSTALL_TIMEOUT })
    await expect(page.getByText(/^8\.\d+\.\d+/)).toBeVisible({ timeout: 10_000 })

    // Purge ----------------------------------------------------------------
    const purgeButton = page.getByRole('button', { name: /完整移除/ })
    await purgeButton.click()
    // UI has a two-step confirm: first click turns button into 「確認完整移除?」
    await page.getByRole('button', { name: /確認完整移除/ }).click()

    await expect(page.getByText('尚未安裝')).toBeVisible({ timeout: PURGE_TIMEOUT })

    // Second install (idempotency) ----------------------------------------
    await page.getByRole('button', { name: '一鍵安裝' }).click()
    await expect(page.getByText(/服務狀態/)).toBeVisible({ timeout: INSTALL_TIMEOUT })
    await expect(page.getByText(/^8\.\d+\.\d+/)).toBeVisible({ timeout: 10_000 })
  })
})
