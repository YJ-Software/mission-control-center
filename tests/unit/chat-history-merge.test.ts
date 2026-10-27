import { describe, it, expect } from 'vitest'
import { mergeHistoryWithLocal, historyRunId, CONTENT_MATCH_WINDOW_MS } from '@/lib/chat-history-merge'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  runId?: string
}

const T = 1_792_995_614_000

function hist(i: number, role: Msg['role'], content: string, timestamp: number, runId?: string): Msg {
  return { id: `hist-${i}`, role, content, timestamp, runId }
}

describe('mergeHistoryWithLocal', () => {
  it('keeps an optimistic user message the history response does not contain yet (2026-10-26 race)', () => {
    // chat.send went out 60–80 ms after chat.history; the history snapshot came back without it
    const history = [hist(0, 'user', 'earlier', T - 60_000, 'a'), hist(1, 'assistant', 'OK', T - 59_000, 'a')]
    const local: Msg[] = [{ id: 'k1', role: 'user', content: '回我一個 OK', timestamp: T, runId: 'k1' }]
    const merged = mergeHistoryWithLocal(history, local)
    expect(merged.map(m => m.id)).toEqual(['hist-0', 'hist-1', 'k1'])
  })

  it('keeps the user message and the final reply in order when both arrive before the history', () => {
    const local: Msg[] = [
      { id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' },
      { id: 'res-k1', role: 'assistant', content: 'OK', timestamp: T + 900, runId: 'k1' },
    ]
    expect(mergeHistoryWithLocal([], local).map(m => m.id)).toEqual(['k1', 'res-k1'])
  })

  it('drops local messages the history already holds, matched by runId', () => {
    const history = [hist(0, 'user', 'hi', T + 400, 'k1'), hist(1, 'assistant', 'OK', T + 900, 'k1')]
    const local: Msg[] = [
      { id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' },
      { id: 'res-k1', role: 'assistant', content: 'OK', timestamp: T + 900, runId: 'k1' },
    ]
    expect(mergeHistoryWithLocal(history, local)).toBe(history)
  })

  it('runId match ignores clock skew between browser and gateway', () => {
    const history = [hist(0, 'user', 'hi', T - 120_000, 'k1')]
    const local: Msg[] = [{ id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' }]
    expect(mergeHistoryWithLocal(history, local)).toBe(history)
  })

  it('does not treat an earlier identical message with a different runId as the same one', () => {
    // the user says "ok" again right after reload; the old "ok" in history must not swallow the new one
    const history = [hist(0, 'user', 'ok', T - 1_000, 'old')]
    const local: Msg[] = [{ id: 'new', role: 'user', content: 'ok', timestamp: T, runId: 'new' }]
    expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'new'])
  })

  it('does not match a user runId against an assistant entry with the same runId', () => {
    const history = [hist(0, 'assistant', 'OK', T + 900, 'k1')]
    const local: Msg[] = [{ id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' }]
    expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'k1'])
  })

  describe('history without runIds (older gateways) — content fallback', () => {
    it('drops a local user message matched by role + content within the window', () => {
      const history = [hist(0, 'user', 'hi', T + 300)]
      const local: Msg[] = [{ id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' }]
      expect(mergeHistoryWithLocal(history, local)).toBe(history)
    })

    it('keeps a local message whose only content match is older than the window', () => {
      const history = [hist(0, 'user', 'hi', T - CONTENT_MATCH_WINDOW_MS - 1)]
      const local: Msg[] = [{ id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' }]
      expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'k1'])
    })

    it('lets each history message absorb at most one local message', () => {
      const history = [hist(0, 'user', 'again', T + 100)]
      const local: Msg[] = [
        { id: 'k1', role: 'user', content: 'again', timestamp: T },
        { id: 'k2', role: 'user', content: 'again', timestamp: T + 50 },
      ]
      expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'k2'])
    })

    it('does not fall back to content matching against history entries that carry a runId', () => {
      const history = [hist(0, 'user', 'hi', T + 100, 'other')]
      const local: Msg[] = [{ id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' }]
      expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'k1'])
    })
  })

  it('returns the history unchanged when nothing was added locally', () => {
    const history = [hist(0, 'user', 'hi', T)]
    expect(mergeHistoryWithLocal(history, [])).toBe(history)
  })

  it('keeps a local send-failure error that has no history counterpart', () => {
    const history = [hist(0, 'user', 'hi', T + 100, 'k1')]
    const local: Msg[] = [
      { id: 'k1', role: 'user', content: 'hi', timestamp: T, runId: 'k1' },
      { id: 'err-k1', role: 'assistant', content: 'Failed to send: x', timestamp: T + 200 },
    ]
    expect(mergeHistoryWithLocal(history, local).map(m => m.id)).toEqual(['hist-0', 'err-k1'])
  })
})

describe('historyRunId', () => {
  it('reads the user idempotencyKey without the :user suffix (OpenClaw 10.7 shape)', () => {
    expect(historyRunId({ role: 'user', idempotencyKey: 'wsagxw8netfmvovamew:user' })).toBe('wsagxw8netfmvovamew')
  })

  it('falls back to __openclaw.idempotencyKey for user messages', () => {
    expect(historyRunId({ role: 'user', __openclaw: { idempotencyKey: 'abc:user' } })).toBe('abc')
  })

  it('reads __openclaw.runId for assistant messages', () => {
    expect(historyRunId({ role: 'assistant', __openclaw: { runId: 'wsagxw8netfmvovamew' } })).toBe('wsagxw8netfmvovamew')
  })

  it('returns undefined when the gateway sends no ids', () => {
    expect(historyRunId({ role: 'user' })).toBeUndefined()
    expect(historyRunId({ role: 'assistant', __openclaw: null })).toBeUndefined()
    expect(historyRunId({ role: 'assistant', __openclaw: { runId: 42 } })).toBeUndefined()
  })
})
