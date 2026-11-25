/** Normalize the native Hermes API to the dashboard read contract. */

import type {
  AgentRuntime,
  ModelDailyEntry,
  ModelTotalsEntry,
  RuntimeAgent,
  RuntimeCronJob,
  RuntimeCronRun,
  RuntimeHealth,
  RuntimeMessage,
  RuntimeSessionRow,
  RuntimeSessionUsage,
  RuntimeUsageReport,
  UsageRange,
} from './types'

/** One row of Hermes' `/api/sessions`. Usage totals ride along on the row. */
interface HermesSession {
  id: string
  title?: string | null
  preview?: string | null
  model?: string | null
  source?: string
  started_at?: number
  last_active?: number
  message_count?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  reasoning_tokens?: number
  estimated_cost_usd?: number | null
  actual_cost_usd?: number | null
}

interface HermesJob {
  id: string
  name?: string
  enabled?: boolean
  schedule?: { kind?: string; expr?: string; display?: string }
  schedule_display?: string
  last_status?: string | null
  last_run_at?: string | number | null
  next_run_at?: string | number | null
  last_error?: string | null
}

export interface HermesRuntimeOptions {
  baseUrl: string
  apiKey: string
  /** Bounds a hung backend; the dashboard would otherwise wait on it. */
  timeoutMs?: number
  /**
   * Injectable for tests. Without it a test that stubs the bridge's fetch still
   * let this half reach the real network — which is how a test asserting
   * "unknown session yields an empty transcript" passed for the wrong reason:
   * the old code swallowed the resulting DNS failure as "no messages".
   */
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_SESSION_LIMIT = 200
const MAX_HISTORY_PAGE = 500
export const HERMES_AGENT = { id: 'hermes-agent', name: 'Hermes', defaultSessionKey: 'mcc-main' } as const

/**
 * Hermes timestamps are epoch SECONDS; every MCC consumer (`dateKey`,
 * `toSessionMessage`, the session list UI) expects epoch MILLISECONDS. Passing
 * seconds through silently renders every date as January 1970, so normalize at
 * the adapter boundary — this is the only place that knows the wire unit.
 */
function toMs(secs: number | null | undefined): number | undefined {
  return secs == null ? undefined : Math.round(secs * 1000)
}

function jobTime(value: string | number | null | undefined): number | undefined {
  const ms = typeof value === 'string' ? Date.parse(value) : toMs(value)
  return ms !== undefined && Number.isFinite(ms) ? ms : undefined
}

function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

function emptyTotals(): ModelTotalsEntry['totals'] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, missingCostEntries: 0 }
}

/** One row of `/api/sessions/{id}/messages`. */
interface HermesMessage {
  role?: string
  content?: unknown
  timestamp?: number | string
  tool_call_id?: string | null
  tool_name?: string | null
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | null
}

/**
 * Reshape one transcript row into what MCC's readers expect.
 *
 * Measured against the real container: Hermes keeps `content` as a STRING and
 * puts tool calls in a separate `tool_calls` array, while a tool result is its
 * own `role: "tool"` row carrying `tool_call_id`. MCC's readers
 * (`use-chat-session.ts`, `toSessionMessage`) only look for tool calls INSIDE a
 * content array and pair results by `toolCallId` — so passing Hermes' shape
 * through renders every tool call invisible and drops every tool result.
 * Timestamps are epoch seconds here and milliseconds everywhere downstream.
 */
function normalizeMessage(m: HermesMessage): RuntimeMessage {
  const timestamp = typeof m.timestamp === 'number' ? toMs(m.timestamp) : m.timestamp
  const text = typeof m.content === 'string' ? m.content : ''

  if (m.tool_call_id) {
    return { role: 'tool', content: text, timestamp, toolCallId: m.tool_call_id }
  }

  const calls = m.tool_calls ?? []
  if (calls.length > 0) {
    const blocks: Array<Record<string, unknown>> = text ? [{ type: 'text', text }] : []
    for (const c of calls) {
      blocks.push({
        type: 'tool_use',
        id: c.id,
        name: c.function?.name || 'tool',
        input: c.function?.arguments,
      })
    }
    return { role: m.role, content: blocks, timestamp }
  }

  return { role: m.role, content: m.content, timestamp }
}

/** Fold one session's counters into an accumulator. */
function addSession(acc: ModelTotalsEntry['totals'], s: HermesSession): void {
  const input = s.input_tokens ?? 0
  const output = s.output_tokens ?? 0
  acc.input += input
  acc.output += output
  acc.cacheRead += s.cache_read_tokens ?? 0
  acc.cacheWrite += s.cache_write_tokens ?? 0
  acc.totalTokens += input + output
  const cost = s.actual_cost_usd ?? s.estimated_cost_usd ?? 0
  acc.totalCost += cost
  // No usable price for this session: force the list-price estimator downstream.
  if (!cost) acc.missingCostEntries = (acc.missingCostEntries ?? 0) + 1
}

export class HermesRuntime implements AgentRuntime {
  readonly id = 'hermes' as const

  constructor(private readonly opts: HermesRuntimeOptions) {}

  private async get<T>(path: string): Promise<T> {
    const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) {
      // Carry the status so callers can tell "no such session" (404) from a
      // backend that is down — swallowing both alike hides real outages.
      const err = new Error(`Hermes ${path} failed: HTTP ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return (await res.json()) as T
  }

  /** Hermes has no agents; the synthetic dashboard identity is independent of model routing. */
  async listAgents(): Promise<RuntimeAgent[]> {
    return [HERMES_AGENT]
  }

  private async fetchSessions(limit: number): Promise<HermesSession[]> {
    const rows = new Map<string, HermesSession>()
    const pageSize = Math.min(limit, DEFAULT_SESSION_LIMIT)
    let offset = 0
    while (rows.size < limit) {
      const page = await this.get<{ data?: HermesSession[]; has_more?: boolean; offset?: number; limit?: number }>(
        `/api/sessions?limit=${pageSize}&offset=${offset}`,
      )
      const data = page.data ?? []
      for (const session of data) {
        if (!rows.has(session.id)) rows.set(session.id, session)
      }
      const nextOffset = (page.offset ?? offset) + (page.limit ?? pageSize)
      if (!page.has_more || !data.length || nextOffset <= offset) break
      offset = nextOffset
    }
    return [...rows.values()].slice(0, limit)
  }

  async listSessions(opts?: { limit?: number }): Promise<RuntimeSessionRow[]> {
    const rows = await this.fetchSessions(opts?.limit ?? DEFAULT_SESSION_LIMIT)
    return rows.map((s) => ({
      key: s.id,
      agentId: HERMES_AGENT.id,
      // `title` is null until Hermes derives one; leave it unset so the caller's
      // own fallback chain runs instead of showing an empty label.
      label: s.title || undefined,
      lastMessagePreview: s.preview || undefined,
      model: s.model || undefined,
      totalTokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0),
      updatedAt: toMs(s.last_active),
      startedAt: toMs(s.started_at),
      sessionId: s.id,
      kind: s.source,
    }))
  }

  async getHistory(sessionKey: string, opts?: { limit?: number }): Promise<RuntimeMessage[]> {
    let remaining = opts?.limit ?? MAX_HISTORY_PAGE
    let offset = 0
    const pages: HermesMessage[][] = []
    while (remaining > 0) {
      const limit = Math.min(remaining, MAX_HISTORY_PAGE)
      const page = await this.get<{ data?: HermesMessage[] }>(
        `/api/sessions/${encodeURIComponent(sessionKey)}/messages?order=latest&limit=${limit}&offset=${offset}`,
      )
      const data = (page.data ?? []).slice(-limit)
      pages.push(data)
      if (data.length < limit) break
      offset += data.length
      remaining -= data.length
    }
    // Native pages count offsets from the newest row and return each page in chronological order.
    return pages.reverse().flat().map(normalizeMessage)
  }

  /**
   * Hermes exposes no aggregate endpoint (every /api/usage, /v1/usage,
   * /api/stats variant 404s), so the buckets the cost UI needs are computed
   * here from the per-session counters that ride on /api/sessions.
   */
  async getUsage(range: UsageRange): Promise<RuntimeUsageReport> {
    const rows = await this.fetchSessions(range.sessionLimit ?? 1000)
    const byModel = new Map<string, ModelTotalsEntry['totals']>()
    const modelDaily = new Map<string, ModelDailyEntry>()
    const days = new Set<string>()
    const sessions: Array<{ key: string; usage: RuntimeSessionUsage | null }> = []

    for (const s of rows) {
      const ts = toMs(s.last_active ?? s.started_at)
      if (!ts) continue
      const date = dayKey(ts, range.timeZone)
      if (date < range.startDate || date > range.endDate) continue
      days.add(date)

      const model = s.model || 'unknown'
      const perSession = emptyTotals()
      addSession(perSession, s)

      const modelTotals = byModel.get(model) ?? emptyTotals()
      addSession(modelTotals, s)
      byModel.set(model, modelTotals)

      const dailyKey = `${date} ${model}`
      const daily = modelDaily.get(dailyKey) ?? { date, model, tokens: 0, cost: 0 }
      daily.tokens += perSession.totalTokens
      daily.cost += perSession.totalCost
      modelDaily.set(dailyKey, daily)

      sessions.push({
        key: s.id,
        usage: { ...perSession, firstActivity: toMs(s.started_at), modelUsage: [{ model, totals: perSession }] },
      })
    }

    return {
      sessions,
      // APPROXIMATE by construction: Hermes reports only per-session lifetime
      // totals, with no per-day breakdown. A session that ran for a week has
      // all of its spend attributed to its last-active day. Nothing downstream
      // can recover the true distribution, so say so rather than present it as
      // exact — see `approximateDaily` on RuntimeUsageReport.
      approximateDaily: true,
      aggregates: {
        byModel: [...byModel].map(([model, totals]) => ({ model, totals })),
        modelDaily: [...modelDaily.values()],
        daily: [...days].sort().map((date) => ({ date })),
      },
    }
  }

  /** Throws on failure — see the contract note on AgentRuntime.listCronJobs. */
  async listCronJobs(opts?: { includeDisabled?: boolean; limit?: number }): Promise<RuntimeCronJob[]> {
    const query = opts?.includeDisabled ? '?include_disabled=true' : ''
    const res = await this.get<{ jobs?: HermesJob[] }>(`/api/jobs${query}`)
    return (res.jobs ?? [])
      .filter((job) => opts?.includeDisabled || job.enabled !== false)
      .slice(0, opts?.limit)
      .map((j) => ({
        id: j.id,
        name: j.name || j.id,
        enabled: j.enabled !== false,
        schedule: j.schedule?.display || j.schedule?.expr || j.schedule_display,
        lastStatus: j.last_status ?? undefined,
        lastRunAt: jobTime(j.last_run_at),
        nextRunAt: jobTime(j.next_run_at),
        lastError: j.last_error ?? undefined,
      }))
  }

  /** Hermes keeps only the last outcome on the job; there is no run history. */
  async getCronRuns(): Promise<RuntimeCronRun[] | null> {
    return null
  }

  async health(): Promise<RuntimeHealth> {
    const res = await this.get<{ status?: string; version?: string }>('/health')
    return { ok: res.status === 'ok', version: res.version ?? null }
  }
}
