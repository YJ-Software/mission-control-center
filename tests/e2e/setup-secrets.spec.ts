import { test, expect } from './fixtures/login'

test('setup → 憑證加固 card: shows plaintext fields, hardens, then reports clean', async ({
  loggedInPage: page, baseURL,
}) => {
  await page.goto(`${baseURL}/setup`)
  await page.getByRole('tab', { name: /憑證加固|Credentials|凭证加固/ }).click()

  // Idempotent: the migration is one-way, so a box a previous run already
  // hardened has no plaintext left and never renders the "found N" state or the
  // action button. Asserting the pre-state unconditionally made a second run
  // hang until the 10-minute test timeout. Branch on the real state instead.
  const before = await (await page.request.get(`${baseURL}/api/setup/secrets`)).json()
  if (before.hardened) {
    await expect(page.getByText(/沒有明文憑證|No plaintext credentials|没有明文凭证/i)).toBeVisible({
      timeout: 30_000,
    })
    return
  }

  // Before: the card must list the plaintext fields it found.
  await expect(page.getByText(/仍有 \d+ 個明文憑證|plaintext credentials still/i)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(before.fields[0])).toBeVisible()

  // Run it. This restarts the gateway, so give it room.
  await page.getByRole('button', { name: /開始加固|Harden credentials|开始加固/ }).click()
  await expect(page.getByText(/已搬移 \d+ 個憑證|Moved \d+ credentials/i)).toBeVisible({
    timeout: 180_000,
  })

  // After: status refreshes to the hardened state.
  await expect(page.getByText(/沒有明文憑證|No plaintext credentials|没有明文凭证/i)).toBeVisible({
    timeout: 30_000,
  })
})
