import { test, expect } from './fixtures/login'

test('setup → 憑證加固 card: shows plaintext fields, hardens, then reports clean', async ({
  loggedInPage: page, baseURL,
}) => {
  await page.goto(`${baseURL}/setup`)
  await page.getByRole('tab', { name: /憑證加固|Credentials|凭证加固/ }).click()

  // Before: the card must list the plaintext fields it found.
  await expect(page.getByText(/仍有 \d+ 個明文憑證|plaintext credentials still/i)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('gateway.auth.token')).toBeVisible()

  // Run it. This restarts the gateway, so give it room.
  await page.getByRole('button', { name: /開始加固|Harden credentials|开始加固/ }).click()
  await expect(page.getByText(/已搬移 \d+ 個憑證|Moved \d+ credentials/i)).toBeVisible({
    timeout: 180_000,
  })

  // After: status refreshes to the hardened state.
  await expect(page.getByText(/沒有明文憑證|No plaintext credentials/i)).toBeVisible({
    timeout: 30_000,
  })
})
