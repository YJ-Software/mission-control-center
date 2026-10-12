import { describe, expect, it } from 'vitest'
import { CHAT_TURN_FAILED } from '../e2e/utils/chat-turn'

describe('E2E CHAT_TURN_FAILED', () => {
  it.each([
    "⚠️ Couldn't sign in to the AI service",
    'Couldn’t sign in to the AI service',
    '⚠️ yuanjhen/deepseek-v4-flash request failed (authentication failed, HTTP 401)',
  ])('matches failure text: %s', (text) => {
    expect(text).toMatch(CHAT_TURN_FAILED)
  })

  it('does not match a normal reply', () => {
    expect('你好，有什麼可以幫忙？').not.toMatch(CHAT_TURN_FAILED)
  })
})
