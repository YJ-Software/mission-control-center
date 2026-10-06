import { expect, type Page } from '@playwright/test'

const REPLY_TIMEOUT = 90_000
/** Texts that mean the turn failed even though a bubble rendered. */
export const CHAT_TURN_FAILED = /LLM request failed|ended before a reply|No API key found|^Failed to send:/i

/**
 * Send one message on /chat and assert the assistant turn really succeeded.
 *
 * A failed turn ALSO renders as a non-empty assistant bubble, in two ways —
 * both passed the chat spec while chat was broken (seen 2026-10-06 on OpenClaw
 * 2026.9.8):
 *  - MCC's error state (data-state="error"), e.g. "No API key found for
 *    provider …" from a chat error event, or "Failed to send: …";
 *  - OpenClaw's own failure text delivered as an ordinary reply, e.g.
 *    "⚠️ LLM request failed (authentication failed, HTTP 401) …".
 */
export async function sendChatAndExpectReply(page: Page, baseURL: string, text: string) {
  await page.goto(`${baseURL}/chat`)

  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 15_000 })
  await input.fill(text)
  await input.press('Enter')

  // chat-message.tsx tags each message with data-role={message.role}; the
  // assistant streams character by character, so wait for non-empty text too.
  const lastAssistant = page.locator('[data-role="assistant"]').last()
  await expect(lastAssistant).toBeVisible({ timeout: REPLY_TIMEOUT })
  await expect(async () => {
    expect((await lastAssistant.innerText()).trim().length).toBeGreaterThan(0)
  }).toPass({ timeout: REPLY_TIMEOUT, intervals: [500, 1_000, 2_000] })

  await expect(lastAssistant, 'chat turn ended in an error state').not.toHaveAttribute('data-state', 'error')
  const reply = (await lastAssistant.innerText()).trim()
  expect(reply, `chat turn failed: ${reply.slice(0, 300)}`).not.toMatch(CHAT_TURN_FAILED)
}
