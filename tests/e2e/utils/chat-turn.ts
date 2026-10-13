import { expect, type Page } from '@playwright/test'

const REPLY_TIMEOUT = 90_000
/** Texts that mean the turn failed even though a bubble rendered. */
// OpenClaw 2026.9.8 words it "⚠️ <provider>/<model> request failed (authentication failed, HTTP 401) …";
// older releases said "LLM request failed …". Match both.
// OpenClaw 2026.10.2 words an auth failure "⚠️ Couldn't sign in to the AI service" (apostrophe may be ’).
export const CHAT_TURN_FAILED = /request failed \(|LLM request failed|Couldn['’]t sign in|ended before a reply|No API key found|^Failed to send:/i

interface TurnResult { state: string | null; text: string }

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
 *
 * The reply checked must be the one answering THIS message. Taking "the last
 * assistant bubble on the page" passed falsely on 2026-10-06: after a restore
 * the session history already held an older successful reply, which matched
 * before the new (failed, HTTP 401) turn rendered. So the message carries a
 * unique marker, and the check waits for the assistant bubble that follows it
 * and for that bubble to leave the streaming state.
 */
export async function sendChatAndExpectReply(page: Page, baseURL: string, text: string) {
  await page.goto(`${baseURL}/chat`)
  await sendChatTurnOnCurrentPage(page, text)
}

/**
 * Same check, on whatever chat page is already open. /talk renders the very
 * same ChatContent as /chat (same data-role / data-state markup), so the
 * customer chat window shares this instead of re-implementing a weaker check:
 * its old "a new non-empty bubble appeared" assertion passed on 2026-10-13
 * while every turn answered "⚠️ Couldn't sign in to the AI service" (HTTP 401).
 */
export async function sendChatTurnOnCurrentPage(page: Page, text: string, opts: { timeout?: number } = {}) {
  const timeout = opts.timeout ?? REPLY_TIMEOUT
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 15_000 })
  const marker = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await input.fill(`${text} (${marker})`)
  await input.press('Enter')

  // chat-message.tsx tags each message with data-role and data-state
  // ('streaming' | 'complete' | 'error' | 'aborted').
  let turn: TurnResult | null = null
  await expect(async () => {
    turn = await page.evaluate((m) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-role]'))
      const userIdx = els.findIndex((e) => e.dataset.role === 'user' && (e.innerText || '').includes(m))
      if (userIdx < 0) return null
      const reply = els.slice(userIdx + 1).find((e) => e.dataset.role === 'assistant')
      if (!reply) return null
      return { state: reply.dataset.state ?? null, text: (reply.innerText || '').trim() }
    }, marker)
    expect(turn, 'no assistant reply after our message yet').not.toBeNull()
    expect(turn!.state, 'assistant reply still streaming').not.toBe('streaming')
    expect(turn!.text.length, 'assistant reply is empty').toBeGreaterThan(0)
  }).toPass({ timeout, intervals: [500, 1_000, 2_000] })

  const { state, text: reply } = turn! as TurnResult
  expect(state, `chat turn ended in state ${state}: ${reply.slice(0, 300)}`).not.toBe('error')
  expect(state, `chat turn was aborted: ${reply.slice(0, 300)}`).not.toBe('aborted')
  expect(reply, `chat turn failed: ${reply.slice(0, 300)}`).not.toMatch(CHAT_TURN_FAILED)
}
