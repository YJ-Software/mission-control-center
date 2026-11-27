import { test, expect } from '../fixtures/login'
import { requireHermes } from '../hermes/target'

const marker = process.env.HERMES_E2E_MARKER
const phase = process.env.HERMES_E2E_MARKER_PHASE

test.skip(!marker || !/^(send|verify)$/.test(phase ?? ''), 'Set the marker and select send or verify')
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('Hermes MCC displays the marker conversation', async ({ loggedInPage: page, baseURL }) => {
  await requireHermes(page.request, baseURL)
  const session = 'mcc-e2e-' + marker!.toLowerCase()
  await page.evaluate(key => localStorage.setItem('chat-page-session', key), session)
  await page.goto('/chat')

  const composer = page.locator('textarea')
  const prompt = 'Reply with exactly ' + marker
  if (phase === 'send') {
    await expect(composer).toBeEnabled()
    await composer.fill(prompt)
    await composer.press('Enter')
  }

  await expect(page.locator('[data-role="user"]').filter({ hasText: prompt })).toBeVisible()
  await expect(page.locator('[data-role="assistant"][data-state="complete"]').filter({ hasText: marker! }))
    .toBeVisible({ timeout: 90_000 })
})
