import { describe, it, expect, vi, afterEach } from 'vitest'
import { OpenClawRuntime } from '@/lib/agent-runtime/openclaw'

/**
 * Pins the Gateway wire shapes this adapter reads.
 *
 * Every assertion below corresponds to a field name that was guessed wrong on
 * the first attempt (`scheduleDisplay` instead of `schedule.expr`, flat
 * `lastRunAt` instead of `state.lastRunAtMs`, `runs` instead of `entries`,
 * `{agents:[…]}` only). Each mistake failed SILENTLY — undefined fields and
 * empty lists, no error — so these tests exist to make the next such change
 * fail loudly instead.
 *
 * `cron-cli.ts`'s mapJob() and api/agents/route.ts remain the authorities; if
 * they change, these change with them.
 */

const rpc = vi.fn()
vi.stubGlobal('__gatewayRpc', rpc)

afterEach(() => rpc.mockReset())

const runtime = () => new OpenClawRuntime()

describe('OpenClawRuntime cron mapping', () => {
  it('reads the schedule expression and the nested run state', async () => {
    rpc.mockResolvedValue({
      jobs: [
        {
          id: 'j1',
          name: 'morning report',
          enabled: true,
          schedule: { kind: 'cron', expr: '30 7 * * *', tz: 'Asia/Taipei' },
          state: { lastRunAtMs: 1_789_500_000_000, nextRunAtMs: 1_789_586_400_000, lastStatus: 'ok' },
        },
      ],
    })

    const [job] = await runtime().listCronJobs()

    expect(job).toEqual({
      id: 'j1',
      name: 'morning report',
      enabled: true,
      schedule: '30 7 * * *',
      lastStatus: 'ok',
      lastRunAt: 1_789_500_000_000,
      nextRunAt: 1_789_586_400_000,
    })
  })

  it('treats a job with no explicit enabled flag as enabled', async () => {
    rpc.mockResolvedValue({ jobs: [{ id: 'j1' }] })
    const [job] = await runtime().listCronJobs()

    expect(job.enabled).toBe(true)
    expect(job.name).toBe('j1')
  })

  it('propagates a cron.list failure instead of reporting an empty schedule', async () => {
    rpc.mockRejectedValue(new Error('AgentSelectionRequiredError'))
    await expect(runtime().listCronJobs()).rejects.toThrow(/AgentSelectionRequired/)
  })

  it('reads run history from `entries`, not `runs`', async () => {
    rpc.mockResolvedValue({ entries: [{ status: 'ok', durationMs: 1200 }] })
    await expect(runtime().getCronRuns('j1')).resolves.toEqual([{ status: 'ok', durationMs: 1200 }])
  })
})

describe('OpenClawRuntime agents', () => {
  it('accepts the {agents:[…]} envelope', async () => {
    rpc.mockResolvedValue({ agents: [{ id: 'main', name: 'Main', status: 'busy' }] })
    await expect(runtime().listAgents()).resolves.toEqual([{ id: 'main', name: 'Main', status: 'busy' }])
  })

  it('also accepts a bare array, and falls back to name as the id', async () => {
    rpc.mockResolvedValue([{ name: 'glm' }])
    await expect(runtime().listAgents()).resolves.toEqual([{ id: 'glm', name: 'glm', status: 'idle' }])
  })
})

describe('OpenClawRuntime usage', () => {
  it('retries without the calendar-mode params when the Gateway rejects them', async () => {
    rpc.mockRejectedValueOnce(new Error('unknown param: mode')).mockResolvedValueOnce({ sessions: [] })

    await runtime().getUsage({ startDate: '2026-09-01', endDate: '2026-09-16', timeZone: 'Asia/Taipei' })

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0][1]).toMatchObject({ mode: 'specific', timeZone: 'Asia/Taipei' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('mode')
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('timeZone')
  })

  it('asks for more than the default 50 sessions', async () => {
    rpc.mockResolvedValue({ sessions: [] })
    await runtime().getUsage({ startDate: '2026-09-01', endDate: '2026-09-16', timeZone: 'UTC' })

    expect(rpc.mock.calls[0][1]).toMatchObject({ limit: 1000, agentScope: 'all' })
  })
})

describe('OpenClawRuntime sessions and history', () => {
  it('passes the Gateway row through untouched', async () => {
    const row = { key: 'agent:main:main', label: 'main', updatedAt: 1_789_500_000_000 }
    rpc.mockResolvedValue({ sessions: [row] })

    await expect(runtime().listSessions()).resolves.toEqual([row])
  })

  it('sends only the options the caller supplied', async () => {
    rpc.mockResolvedValue({ sessions: [] })

    // The cost path asks for titles but not previews; it must stay that way.
    await runtime().listSessions({ limit: 200, includeDerivedTitles: true })
    expect(rpc.mock.calls[0][1]).toEqual({ limit: 200, includeDerivedTitles: true })

    rpc.mockClear()
    await runtime().listSessions({ limit: 200, includeLastMessage: true, includeDerivedTitles: true })
    expect(rpc.mock.calls[0][1]).toEqual({ limit: 200, includeLastMessage: true, includeDerivedTitles: true })
  })

  it('returns an empty transcript rather than throwing on a null response', async () => {
    rpc.mockResolvedValue(null)
    await expect(runtime().getHistory('agent:main:main')).resolves.toEqual([])
  })
})

describe('OpenClawRuntime health', () => {
  it('reports ok when cron.status answers, and not-ok when it does not', async () => {
    rpc.mockResolvedValueOnce({})
    await expect(runtime().health()).resolves.toEqual({ ok: true })

    rpc.mockRejectedValueOnce(new Error('Gateway RPC not available'))
    await expect(runtime().health()).resolves.toEqual({ ok: false })
  })
})
