import { test, expect } from './fixtures/login'

const REPLY_TIMEOUT = 90_000

test('chat: send a message and receive a reply', async ({ loggedInPage: page, baseURL }) => {
  await page.goto(`${baseURL}/chat`)

  // Wait for chat panel to load (textarea is the main interactive element).
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 15_000 })
  await input.fill('回我一個 OK')

  // Send via Enter (chat-input.tsx handles Enter to submit).
  await input.press('Enter')

  // Reply: an assistant-side message bubble must appear with non-empty content.
  // chat-message.tsx tags each message with data-role={message.role}; the
  // assistant streams character by character, so wait for non-empty text too.
  const lastAssistant = page.locator('[data-role="assistant"]').last()
  await expect(lastAssistant).toBeVisible({ timeout: REPLY_TIMEOUT })
  await expect(async () => {
    expect((await lastAssistant.innerText()).trim().length).toBeGreaterThan(0)
  }).toPass({ timeout: REPLY_TIMEOUT, intervals: [500, 1_000, 2_000] })
})
