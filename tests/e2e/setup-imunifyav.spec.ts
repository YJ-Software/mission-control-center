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

// 12 min, not 5. The installer pulls Defence360 packages from CloudLinux's repo
// and, on the 2-core throwaway, that regularly outruns a 5-min budget — the
// 2026-07-17 run failed here while `imunify-antivirus` (8.8.5) in fact installed
// fine and its service came up active, just late. This spec installs twice
// (install → purge → install), so it pays that cost on both halves.
const INSTALL_TIMEOUT = 12 * 60 * 1000
const PURGE_TIMEOUT = 3 * 60 * 1000

test.describe('ImunifyAV setup flow', () => {
  test('install → purge → install (idempotent)', async ({ loggedInPage: page, baseURL }) => {
    // Two installs plus two purges blow past the 10-min global timeout.
    test.setTimeout(35 * 60 * 1000)

    await page.goto(`${baseURL}/setup`)
    await page.getByRole('tab', { name: /防毒軟體|ImunifyAV/i }).click()

    // Normalize starting state: the status panel takes a few seconds to
    // load (the `/api/setup/imunifyav/status` poll). Wait until we see
    // either the install or the purge button, then branch.
    const installBtn = page.getByRole('button', { name: '一鍵安裝' })
    const purgeBtn = page.getByRole('button', { name: /完整移除/ }).first()
    await expect(installBtn.or(purgeBtn)).toBeVisible({ timeout: 15_000 })
    if (await purgeBtn.isVisible().catch(() => false)) {
      await purgeBtn.click()
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
