import { describe, it, expect, vi, afterEach } from 'vitest'
import { HermesRuntime } from '@/lib/agent-runtime/hermes'
import { priceModelUsage } from '@/lib/usage-pricing'

/**
 * Pins the Hermes adapter's contract. The behaviours below are the ones that
 * fail silently if they regress: a swallowed cron error looks like "no jobs",
 * and a zero `missingCostEntries` makes every cost render as $0.
 */

const BASE = 'http://hermes.test'
const runtime = () => new HermesRuntime({ baseUrl: BASE, apiKey: 'k' })

function mockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const path = String(url).replace(BASE, '')
    const key = Object.keys(routes).find((r) => path.startsWith(r))
    if (key === undefined) return new Response('not found', { status: 404 })
    const body = routes[key]
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  model: 'deepseek-v4-flash',
  started_at: 1_789_500_000,
  last_active: 1_789_500_060,
  input_tokens: 1000,
  output_tokens: 100,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  estimated_cost_usd: 0,
  actual_cost_usd: null,
  ...over,
})

const RANGE = { startDate: '2000-01-01', endDate: '2100-01-01', timeZone: 'UTC' }

afterEach(() => vi.unstubAllGlobals())

describe('HermesRuntime', () => {
  it('reports missingCostEntries so unpriced usage falls back to list prices', async () => {
    mockFetch({ '/api/sessions': { data: [session()] } })
    const report = await runtime().getUsage(RANGE)

    const entry = report.aggregates!.byModel![0]
    expect(entry.totals.missingCostEntries).toBeGreaterThan(0)

    // The whole point: the pricing layer must treat this as estimated, not $0.
    const priced = priceModelUsage(entry.provider, entry.model, entry.totals)
    expect(priced.estimated).toBe(true)
    expect(priced.cost).toBeGreaterThan(0)
  })

  it('trusts a backend-supplied cost and leaves missingCostEntries at zero', async () => {
    mockFetch({ '/api/sessions': { data: [session({ actual_cost_usd: 0.42 })] } })
    const report = await runtime().getUsage(RANGE)

    const entry = report.aggregates!.byModel![0]
    expect(entry.totals.missingCostEntries).toBe(0)
    expect(priceModelUsage(entry.provider, entry.model, entry.totals)).toEqual({ cost: 0.42, estimated: false })
  })

  it('buckets sessions into per-model and per-day aggregates', async () => {
    mockFetch({
      '/api/sessions': {
        data: [
          session({ id: 'a', last_active: 1_789_500_000 }),
          session({ id: 'b', last_active: 1_789_500_000, model: 'glm-5', input_tokens: 5, output_tokens: 5 }),
        ],
      },
    })
    const report = await runtime().getUsage(RANGE)

    expect(report.aggregates!.byModel!.map((e) => e.model).sort()).toEqual(['deepseek-v4-flash', 'glm-5'])
    expect(report.aggregates!.daily).toHaveLength(1)
    expect(report.aggregates!.modelDaily!.every((d) => d.tokens > 0)).toBe(true)
    expect(report.sessions).toHaveLength(2)
  })

  it('excludes sessions outside the requested window', async () => {
    mockFetch({ '/api/sessions': { data: [session({ last_active: 1_600_000_000 })] } })
    const report = await runtime().getUsage({ startDate: '2026-09-01', endDate: '2026-09-30', timeZone: 'UTC' })

    expect(report.sessions).toHaveLength(0)
    expect(report.aggregates!.byModel).toHaveLength(0)
  })

  it('THROWS when cron jobs cannot be read — never returns an empty list', async () => {
    mockFetch({ '/api/jobs': new Error('connection refused') })
    await expect(runtime().listCronJobs()).rejects.toThrow()
  })

  it('distinguishes "no run history support" (null) from "never ran" ([])', async () => {
    mockFetch({})
    await expect(runtime().getCronRuns()).resolves.toBeNull()
  })

  it('leaves an absent title unset so the caller\'s fallback chain runs', async () => {
    mockFetch({ '/api/sessions': { data: [session({ title: null, preview: '' })] } })
    const [row] = await runtime().listSessions()

    expect(row.label).toBeUndefined()
    expect(row.lastMessagePreview).toBeUndefined()
    expect(row.key).toBe('s1')
  })

  it('maps job schedule and status', async () => {
    mockFetch({
      '/api/jobs': {
        jobs: [{ id: 'j1', name: 'nightly', enabled: true, schedule: { kind: 'cron', display: '0 4 * * *' }, last_status: 'ok' }],
      },
    })
    const [job] = await runtime().listCronJobs()

    expect(job).toMatchObject({ id: 'j1', name: 'nightly', enabled: true, schedule: '0 4 * * *', lastStatus: 'ok' })
  })

  it('surfaces health and version', async () => {
    mockFetch({ '/health': { status: 'ok', version: '0.21.3' } })
    await expect(runtime().health()).resolves.toEqual({ ok: true, version: '0.21.3' })
  })
})

/**
 * Hermes speaks epoch SECONDS; every MCC consumer feeds these numbers straight
 * into `new Date(...)` / `Intl.DateTimeFormat`, which mean MILLISECONDS. The
 * first cut of this adapter passed seconds through and every date rendered as
 * January 1970 — the earlier tests missed it because they only asserted that a
 * value was present. These assert the actual instant.
 */
describe('HermesRuntime timestamp normalization', () => {
  // 2026-09-16T04:21:16Z
  const SECS = 1_789_532_476
  const MS = SECS * 1000

  it('converts session timestamps to milliseconds', async () => {
    mockFetch({ '/api/sessions': { data: [session({ started_at: SECS, last_active: SECS })] } })
    const [row] = await runtime().listSessions()

    expect(row.updatedAt).toBe(MS)
    expect(row.startedAt).toBe(MS)
    expect(new Date(row.updatedAt!).getUTCFullYear()).toBe(2026)
  })

  it('buckets usage into the real calendar day, not 1970', async () => {
    mockFetch({ '/api/sessions': { data: [session({ started_at: SECS, last_active: SECS })] } })
    const report = await runtime().getUsage({ startDate: '2026-09-01', endDate: '2026-09-30', timeZone: 'UTC' })

    expect(report.aggregates!.daily).toEqual([{ date: '2026-09-16' }])
    expect(report.sessions![0].usage!.firstActivity).toBe(MS)
  })

  it('converts message timestamps to milliseconds', async () => {
    mockFetch({ '/api/sessions': { data: [{ role: 'user', content: 'hi', timestamp: SECS }] } })
    const [msg] = await runtime().getHistory('s1')

    expect(msg.timestamp).toBe(MS)
  })

  it('converts cron job timestamps to milliseconds', async () => {
    mockFetch({ '/api/jobs': { jobs: [{ id: 'j1', last_run_at: SECS, next_run_at: SECS }] } })
    const [job] = await runtime().listCronJobs()

    expect(job.lastRunAt).toBe(MS)
    expect(job.nextRunAt).toBe(MS)
  })

  it('leaves absent timestamps undefined rather than emitting epoch zero', async () => {
    mockFetch({ '/api/jobs': { jobs: [{ id: 'j1' }] } })
    const [job] = await runtime().listCronJobs()

    expect(job.lastRunAt).toBeUndefined()
    expect(job.nextRunAt).toBeUndefined()
  })
})
