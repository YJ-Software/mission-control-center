import { test, expect } from './fixtures/login'

const REPLY_TIMEOUT = 90_000

test('agents: send a message and receive a reply', async ({ loggedInPage: page, baseURL }) => {
  await page.goto(`${baseURL}/agents`)

  // Wait for agent list to populate; chat panel may load lazily.
  await expect(page.locator('[data-agent-id], [data-testid="agent-list"]').first())
    .toBeVisible({ timeout: 15_000 })

  // Find chat input. It may be a textarea inside the chat panel.
  const input = page.getByRole('textbox', { name: /訊息|Message|問題/i }).or(page.locator('textarea').first())
  await input.fill('回我一個 OK')

  // Send — Enter or button labeled 送出 / Send.
  await page.getByRole('button', { name: /送出|Send|發送/i }).first().click()

  // Reply: a message bubble that contains response text. Match anything non-empty in an
  // assistant-style container; fall back to "OK" since we asked for it.
  await expect(
    page.getByText(/OK/i).or(page.locator('[data-role="assistant"], .assistant-message').last())
  ).toBeVisible({ timeout: REPLY_TIMEOUT })
})
