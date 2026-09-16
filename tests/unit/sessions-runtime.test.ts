import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The plumbing in sessions.ts — the three functions that actually fetch.
 *
 * sessions-gateway.test.ts pins the pure mappers, but getSessions /
 * getSessionMessages / getCostData had no coverage at all, which is exactly
 * where moving them behind AgentRuntime could have broken them silently. These
 * assert the wiring: what gets requested, how the usage join happens, and what
 * survives a partial failure.
 */

const listSessions = vi.fn()
const getUsage = vi.fn()
const getHistory = vi.fn()

vi.mock('@/lib/agent-runtime', () => ({
  getAgentRuntime: () => ({ id: 'test', listSessions, getUsage, getHistory }),
}))

const { getSessions, getSessionMessages, getCostData } = await import('@/lib/sessions')

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, missingCostEntries: 0 }

beforeEach(() => {
  listSessions.mockReset()
  getUsage.mockReset()
  getHistory.mockReset()
  listSessions.mockResolvedValue([])
  getUsage.mockResolvedValue({})
  getHistory.mockResolvedValue([])
})

describe('getSessions', () => {
  it('asks for previews and derived titles, and joins usage onto the rows', async () => {
    listSessions.mockResolvedValue([{ key: 'agent:main:main', label: 'main', updatedAt: 2000 }])
    getUsage.mockResolvedValue({
      sessions: [{ key: 'agent:main:main', usage: { ...zero, totalTokens: 1234, totalCost: 0.5 } }],
    })

    const [info] = await getSessions()

    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ includeLastMessage: true, includeDerivedTitles: true }),
    )
    expect(info.totalTokens).toBe(1234)
    expect(info.cost).toBe(0.5)
  })

  it('still lists sessions when the usage call fails', async () => {
    listSessions.mockResolvedValue([{ key: 'agent:main:main', totalTokens: 7 }])
    getUsage.mockRejectedValue(new Error('usage unavailable'))

    const [info] = await getSessions()

    expect(info.totalTokens).toBe(7)
    expect(info.cost).toBe(0)
  })

  it('propagates a session-list failure instead of rendering an empty list', async () => {
    listSessions.mockRejectedValue(new Error('gateway down'))
    await expect(getSessions()).rejects.toThrow(/gateway down/)
  })
})

describe('getSessionMessages', () => {
  it('maps transcript entries and drops the ones with no renderable text', async () => {
    getHistory.mockResolvedValue([
      { role: 'user', content: 'hi', timestamp: 0 },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: '' },
    ])

    const msgs = await getSessionMessages('agent:main:main')

    expect(getHistory).toHaveBeenCalledWith('agent:main:main', { limit: 30 })
    expect(msgs.map((m) => m.content)).toEqual(['hi', 'hello'])
  })
})

describe('getCostData', () => {
  it('requests a calendar window with a raised session limit', async () => {
    await getCostData()

    const range = getUsage.mock.calls[0][0]
    expect(range.sessionLimit).toBeGreaterThan(50)
    expect(range.agentScope).toBe('all')
    expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.startDate < range.endDate).toBe(true)
  })

  it('still reports spend when the session list fails — only the labels are lost', async () => {
    const totals = { ...zero, input: 1_000_000, totalTokens: 1_000_000, totalCost: 0, missingCostEntries: 1 }
    listSessions.mockRejectedValue(new Error('list unavailable'))
    getUsage.mockResolvedValue({
      sessions: [{ key: 'agent:main:main', usage: { ...totals, modelUsage: [{ provider: 'kimi', model: 'k3', totals }] } }],
      aggregates: {
        byModel: [{ provider: 'kimi', model: 'k3', totals }],
        modelDaily: [],
        daily: [],
      },
    })

    const data = await getCostData()

    expect(data.perModel['kimi/k3']).toBeGreaterThan(0)
    expect(data.estimated).toBe(true)
  })
})
