/**
 * Hermes Agent backend for {@link AgentRuntime}.
 *
 * Measured against `nousresearch/hermes-agent:v2026.9.14` on 2026-09-16, not
 * read off its docs — which disagree with the implementation in several places
 * (`API_SERVER_ENABLED` is a no-op, `skills_api: true` but `/v1/skills` 500s,
 * the stream emits `message.delta` where the docs say `assistant.delta`).
 *
 * Gaps this backend cannot fill, handled explicitly below:
 * - No agents concept        -> one synthetic agent from /health + /v1/models.
 * - No usage aggregate API   -> bucketed here from per-session token counts.
 * - No per-job run history   -> getCronRuns returns null (≠ empty).
 * - No cost figures          -> missingCostEntries forces list-price estimation.
 */

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
  last_status?: string
  last_run_at?: number
  next_run_at?: number
  last_error?: string
}

export interface HermesRuntimeOptions {
  baseUrl: string
  apiKey: string
  /** Bounds a hung backend; the dashboard would otherwise wait on it. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_SESSION_LIMIT = 200

/**
 * Hermes timestamps are epoch SECONDS; every MCC consumer (`dateKey`,
 * `toSessionMessage`, the session list UI) expects epoch MILLISECONDS. Passing
 * seconds through silently renders every date as January 1970, so normalize at
 * the adapter boundary — this is the only place that knows the wire unit.
 */
function toMs(secs: number | null | undefined): number | undefined {
  return secs == null ? undefined : Math.round(secs * 1000)
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
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Hermes ${path} failed: HTTP ${res.status}`)
    return (await res.json()) as T
  }

  /** Hermes has no agents; present the server itself as one so the UI has a row. */
  async listAgents(): Promise<RuntimeAgent[]> {
    const health = await this.get<{ status?: string; platform?: string }>('/health')
    let id = 'hermes-agent'
    try {
      const models = await this.get<{ data?: Array<{ id?: string }> }>('/v1/models')
      id = models.data?.[0]?.id || id
    } catch {
      // The model list is decoration here; health already proved the backend is up.
    }
    return [{ id, name: health.platform || 'hermes', status: health.status }]
  }

  private async fetchSessions(limit: number): Promise<HermesSession[]> {
    const res = await this.get<{ data?: HermesSession[] }>(`/api/sessions?limit=${limit}`)
    return res.data ?? []
  }

  async listSessions(opts?: { limit?: number }): Promise<RuntimeSessionRow[]> {
    const rows = await this.fetchSessions(opts?.limit ?? DEFAULT_SESSION_LIMIT)
    return rows.map((s) => ({
      key: s.id,
      agentId: 'hermes-agent',
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
    const res = await this.get<{ data?: RuntimeMessage[] }>(
      `/api/sessions/${encodeURIComponent(sessionKey)}/messages`,
    )
    // Same seconds->milliseconds normalization as the session rows: callers feed
    // `timestamp` straight into `new Date(...)`.
    const msgs = (res.data ?? []).map((m) =>
      typeof m.timestamp === 'number' ? { ...m, timestamp: toMs(m.timestamp) } : m,
    )
    const limit = opts?.limit
    return limit && msgs.length > limit ? msgs.slice(-limit) : msgs
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
      aggregates: {
        byModel: [...byModel].map(([model, totals]) => ({ model, totals })),
        modelDaily: [...modelDaily.values()],
        daily: [...days].sort().map((date) => ({ date })),
      },
    }
  }

  /** Throws on failure — see the contract note on AgentRuntime.listCronJobs. */
  async listCronJobs(): Promise<RuntimeCronJob[]> {
    const res = await this.get<{ jobs?: HermesJob[] }>('/api/jobs')
    return (res.jobs ?? []).map((j) => ({
      id: j.id,
      name: j.name || j.id,
      enabled: j.enabled !== false,
      schedule: j.schedule?.display || j.schedule?.expr || j.schedule_display,
      lastStatus: j.last_status,
      lastRunAt: toMs(j.last_run_at),
      nextRunAt: toMs(j.next_run_at),
      lastError: j.last_error,
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
