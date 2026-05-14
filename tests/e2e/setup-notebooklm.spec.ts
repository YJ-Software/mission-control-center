import { test, expect } from './fixtures/login'

const INSTALL_TIMEOUT = 5 * 60 * 1000

test('notebooklm setup: install uv + nlm CLI + CDP patch', async ({ loggedInPage: page, baseURL }) => {
  await page.goto(`${baseURL}/setup`)
  await page.getByRole('tab', { name: /NotebookLM/i }).click()

  // Wait for the status section to mount so the StatusBadges are visible.
  await expect(page.getByText('目前狀態')).toBeVisible({ timeout: 10_000 })

  // The action area shows "一鍵安裝" while any of uv / nlm / patch is missing,
  // and flips to "重新套用補丁" once all three are installed. Use that flip as
  // the canonical "install done" signal.
  const installButton = page.getByRole('button', { name: '一鍵安裝' })
  const repatchButton = page.getByRole('button', { name: '重新套用補丁' })

  if (await installButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await installButton.click()
    await expect(repatchButton).toBeVisible({ timeout: INSTALL_TIMEOUT })
  }

  // Post-install invariants — all three components reported installed.
  await expect(repatchButton).toBeVisible()
  await expect(page.getByText('未安裝')).not.toBeVisible({ timeout: 5_000 })

  // Idempotency: re-running the patch step should leave everything green.
  await repatchButton.click()
  await expect(repatchButton).toBeEnabled({ timeout: INSTALL_TIMEOUT })
  await expect(page.getByText('未安裝')).not.toBeVisible({ timeout: 5_000 })
})
