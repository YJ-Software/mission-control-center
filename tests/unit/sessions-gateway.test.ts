import { describe, expect, it } from 'vitest'
import { buildCostData, dateKey, rollupUsageToRows, sessionCost, toSessionInfo, toSessionMessage } from '@/lib/sessions'

// Sessions and transcripts left the JSON/JSONL files MCC used to read, so the
// dashboard's Recent Activity and Daily Spend rendered empty. These pin the
// mapping from the Gateway's sessions.list / sessions.usage / chat.history.

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, missingCostEntries: 0 }

describe('toSessionInfo', () => {
  it('maps a sessions.list row, preferring usage tokens and pricing unpriced models', () => {
    const info = toSessionInfo(
      {
        key: 'agent:main:cron:abc', label: 'Cron: 晨報', lastMessagePreview: '完成', model: 'k3', modelProvider: 'kimi',
        totalTokens: 100, kind: 'direct', updatedAt: 2000, sessionStartedAt: 1000, abortedLastRun: false, sessionId: 's1', agentId: 'main',
      },
      {
        ...zero, input: 1_000_000, output: 100_000, cacheRead: 10_000_000, totalTokens: 11_100_000, missingCostEntries: 4,
        modelUsage: [{ provider: 'kimi', model: 'k3', totals: { ...zero, input: 1_000_000, output: 100_000, cacheRead: 10_000_000, totalTokens: 11_100_000, missingCostEntries: 4 } }],
      },
    )
    expect(info).toEqual({
      key: 'agent:main:cron:abc', label: 'Cron: 晨報', model: 'kimi/k3', totalTokens: 11_100_000, contextTokens: 0,
      kind: 'direct', updatedAt: 2000, createdAt: 1000, aborted: false, channel: '-', sessionId: 's1',
      lastMessage: '完成', cost: 7.5, agentId: 'main',
    })
  })

  it('falls back to a derived title and a readable name', () => {
    expect(toSessionInfo({ key: 'agent:main:main', derivedTitle: '回一個字' }).label).toBe('回一個字')
    expect(toSessionInfo({ key: 'agent:main:main' }).label).toBe('main')
    expect(toSessionInfo({ key: 'agent:main:main' }).model).toBe('-')
    expect(toSessionInfo({ key: 'agent:main:3b3af6e8477fc099382bfa3c2dfa-2606-1789459596207' }).label).toBe('Session 3b3af6e8')
  })
})

describe('sessionCost', () => {
  it('uses OpenClaw totalCost when there is no per-model breakdown', () => {
    expect(sessionCost({ ...zero, totalCost: 0.42 })).toBe(0.42)
    expect(sessionCost(null)).toBe(0)
  })
})

describe('toSessionMessage', () => {
  it('extracts text, tool calls and timestamps from chat.history entries', () => {
    expect(toSessionMessage({ role: 'assistant', content: [{ type: 'text', text: 'OK' }], timestamp: 0 }))
      .toEqual({ role: 'assistant', content: 'OK', timestamp: '1970-01-01T00:00:00.000Z' })
    expect(toSessionMessage({ role: 'assistant', content: [{ type: 'toolCall', name: 'exec' }] })?.content).toBe('🔧 exec')
    expect(toSessionMessage({ role: 'user', content: '' })).toBeNull()
  })
})

describe('buildCostData', () => {
  it('builds dashboard spend with estimates, today, week and per-session labels', () => {
    const k3Totals = { ...zero, input: 1_000_000, output: 100_000, cacheRead: 10_000_000, totalTokens: 11_100_000, missingCostEntries: 9 }
    const data = buildCostData(
      {
        sessions: [
          { key: 'agent:main:main', usage: { ...k3Totals, modelUsage: [{ provider: 'kimi', model: 'k3', totals: k3Totals }] } },
          { key: 'agent:main:idle', usage: null },
        ],
        aggregates: {
          byModel: [
            { provider: 'kimi', model: 'k3', totals: k3Totals },
            { provider: 'openai', model: 'gpt-5.4-mini', totals: { ...zero, input: 10, totalTokens: 10, totalCost: 0.5 } },
            { provider: 'openclaw', model: 'delivery-mirror', totals: zero },
          ],
          modelDaily: [
            { date: '2026-09-08', provider: 'kimi', model: 'k3', tokens: 5_550_000, cost: 0 },
            { date: '2026-09-15', provider: 'kimi', model: 'k3', tokens: 5_550_000, cost: 0 },
            { date: '2026-09-15', provider: 'openai', model: 'gpt-5.4-mini', tokens: 10, cost: 0.5 },
          ],
          daily: [{ date: '2026-09-08' }, { date: '2026-09-12' }, { date: '2026-09-15' }],
        },
      },
      [{ key: 'agent:main:main', derivedTitle: '主對話' }],
      { todayKey: '2026-09-15', weekKeys: ['2026-09-15', '2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10', '2026-09-09'], windowDays: 90 },
    )
    expect(data.estimated).toBe(true)
    expect(data.perModel).toEqual({ 'kimi/k3': 7.5, 'openai/gpt-5.4-mini': 0.5 })
    expect(data.total).toBeCloseTo(8, 10)
    expect(data.perDay['2026-09-12']).toBe(0)
    expect(data.today).toBeCloseTo(3.75 + 0.5, 10)
    expect(data.week).toBeCloseTo(4.25, 10)
    expect(data.perSession).toEqual({ 'agent:main:main': { cost: 7.5, label: '主對話' } })
  })
})

describe('dateKey', () => {
  it('uses the calendar day of the given time zone', () => {
    // 2026-09-14T20:00Z is already 09-15 in Taipei
    expect(dateKey(Date.UTC(2026, 8, 14, 20), 'Asia/Taipei')).toBe('2026-09-15')
    expect(dateKey(Date.UTC(2026, 8, 14, 20), 'UTC')).toBe('2026-09-14')
  })
})

describe('rollupUsageToRows', () => {
  // Cron usage is keyed per run; the session list shows the job once.
  const k3 = (tokens: number) => ({ ...zero, input: tokens, totalTokens: tokens, missingCostEntries: 1 })
  const run = (tokens: number) => ({ ...k3(tokens), firstActivity: tokens, modelUsage: [{ provider: 'kimi', model: 'k3', totals: k3(tokens) }] })

  it('rolls cron runs into their job row and leaves unmatched usage on its own key', () => {
    const out = rollupUsageToRows(
      ['agent:main:main', 'agent:main:cron:job1'],
      [
        { key: 'agent:main:cron:job1:run:a', usage: run(1_000_000) },
        { key: 'agent:main:cron:job1:run:b', usage: run(3_000_000) },
        { key: 'agent:main:main', usage: run(500_000) },
        { key: 'agent:main:oneoff-123', usage: run(200_000) },
        { key: 'agent:main:cron:job1:run:c', usage: null },
      ],
    )
    expect(out.get('agent:main:cron:job1')).toMatchObject({ totalTokens: 4_000_000, firstActivity: 1_000_000 })
    expect(out.get('agent:main:cron:job1')?.modelUsage).toHaveLength(2)
    expect(sessionCost(out.get('agent:main:cron:job1'))).toBeCloseTo(12, 10) // 4M input × $3
    expect(out.get('agent:main:main')?.totalTokens).toBe(500_000)
    expect(out.get('agent:main:oneoff-123')?.totalTokens).toBe(200_000)
  })

  it('does not treat a shared text prefix as ownership', () => {
    const out = rollupUsageToRows(['agent:main:cron:job1'], [{ key: 'agent:main:cron:job10:run:a', usage: run(10) }])
    expect(out.has('agent:main:cron:job1')).toBe(false)
    expect(out.get('agent:main:cron:job10:run:a')?.totalTokens).toBe(10)
  })
})
