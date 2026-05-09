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
  // The chat message list usually has structured roles; fall back to "assistant"
  // text node or a chat-message container.
  const lastMessage = page.locator('[data-role="assistant"], .chat-message-assistant, [data-message-role="assistant"]').last()
  await expect(lastMessage).toBeVisible({ timeout: REPLY_TIMEOUT })
  await expect(lastMessage).not.toBeEmpty()
})
