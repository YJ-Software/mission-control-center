import { gatewayRequest } from '@/lib/gateway-rpc'
import {
  priceDaily,
  priceModelUsage,
  type GatewayUsageTotals,
  type ModelDailyEntry,
  type ModelTotalsEntry,
} from '@/lib/usage-pricing'

// OpenClaw moved session indexes and transcripts out of
// ~/.openclaw/agents/*/sessions/{sessions.json,*.jsonl} into SQLite. Reading
// those files now finds nothing, which left Recent Activity, Daily Spend,
// /sessions and /costs empty. The Gateway's session and usage RPCs are the
// supported view of the same data.

const LIST_LIMIT = 200
/** Window for usage and spend. The Gateway computes usage from transcripts, so this bounds the work. */
const USAGE_WINDOW_DAYS = 90
const DAY_MS = 86_400_000
/** sessions.usage returns 50 sessions unless asked for more. */
const USAGE_SESSION_LIMIT = 1000

interface GatewaySessionRow {
  key: string
  label?: string
  displayName?: string
  derivedTitle?: string
  lastMessagePreview?: string
  model?: string
  modelProvider?: string
  totalTokens?: number
  contextTokens?: number
  kind?: string
  chatType?: string
  lastChannel?: string
  updatedAt?: number
  startedAt?: number
  sessionStartedAt?: number
  abortedLastRun?: boolean
  sessionId?: string
  agentId?: string
}

interface GatewayModelUsage {
  provider?: string
  model: string
  totals: GatewayUsageTotals
}

interface GatewaySessionUsage extends GatewayUsageTotals {
  firstActivity?: number
  modelUsage?: GatewayModelUsage[]
}

interface GatewayUsagePayload {
  sessions?: Array<{ key: string; usage: GatewaySessionUsage | null }>
  aggregates?: {
    byModel?: ModelTotalsEntry[]
    modelDaily?: ModelDailyEntry[]
    daily?: Array<{ date: string }>
  }
}

function serverTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Calendar date (YYYY-MM-DD) of `ts` in `timeZone`. */
export function dateKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts)
}

async function fetchUsage(days: number): Promise<GatewayUsagePayload> {
  const timeZone = serverTimeZone()
  const now = Date.now()
  const range = {
    startDate: dateKey(now - (days - 1) * DAY_MS, timeZone),
    endDate: dateKey(now, timeZone),
    agentScope: 'all',
    limit: USAGE_SESSION_LIMIT,
  }
  try {
    return (await gatewayRequest('sessions.usage', { ...range, mode: 'specific', timeZone })) as GatewayUsagePayload
  } catch {
    // Older Gateways reject the calendar-mode params; their buckets are UTC days.
    return (await gatewayRequest('sessions.usage', range)) as GatewayUsagePayload
  }
}

function resolveName(key: string): string {
  const rest = key.replace(/^agent:[^:]+:/, '')
  if (rest === 'main') return 'main'
  if (rest.startsWith('cron:')) return 'Cron'
  if (rest.includes('subagent')) return 'Subagent'
  // One-off runs are keyed by a bare hash (`<hex>-<n>-<ts>`) and never appear in
  // sessions.list, so there is no title to show — keep the name short.
  if (/^[0-9a-f]{12,}/.test(rest)) return `Session ${rest.slice(0, 8)}`
  return rest.split(':').slice(0, 2).join(':') || key
}

/** Session spend: OpenClaw's price per model where it has one, a list-price estimate where it does not. */
export function sessionCost(usage: GatewaySessionUsage | null | undefined): number {
  if (!usage) return 0
  if (!usage.modelUsage?.length) return usage.totalCost || 0
  return usage.modelUsage.reduce((sum, m) => sum + priceModelUsage(m.provider, m.model, m.totals).cost, 0)
}

const ZERO_TOTALS: GatewayUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, missingCostEntries: 0 }

function mergeUsage(parts: GatewaySessionUsage[]): GatewaySessionUsage | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  const merged: GatewaySessionUsage = { ...ZERO_TOTALS, modelUsage: [] }
  for (const u of parts) {
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'totalCost', 'missingCostEntries'] as const) {
      merged[k] = (merged[k] ?? 0) + (u[k] ?? 0)
    }
    if (u.firstActivity && (!merged.firstActivity || u.firstActivity < merged.firstActivity)) merged.firstActivity = u.firstActivity
    merged.modelUsage!.push(...(u.modelUsage ?? []))
  }
  return merged
}

/**
 * Attach usage to session rows. Cron usage is recorded per run under
 * `agent:<id>:cron:<job>:run:<run>`, while sessions.list shows the job once as
 * `agent:<id>:cron:<job>` — so a run rolls up into the row its key extends.
 * Usage with no matching row keeps its own key.
 */
export function rollupUsageToRows(
  rowKeys: string[],
  usageSessions: Array<{ key: string; usage: GatewaySessionUsage | null }>,
): Map<string, GatewaySessionUsage> {
  const rows = [...rowKeys].sort((a, b) => b.length - a.length) // longest prefix wins
  const grouped = new Map<string, GatewaySessionUsage[]>()
  for (const s of usageSessions) {
    if (!s.usage) continue
    const owner = rows.find((k) => s.key === k || s.key.startsWith(k + ':')) ?? s.key
    grouped.set(owner, [...(grouped.get(owner) ?? []), s.usage])
  }
  const out = new Map<string, GatewaySessionUsage>()
  for (const [key, parts] of grouped) {
    const merged = mergeUsage(parts)
    if (merged) out.set(key, merged)
  }
  return out
}

export interface SessionInfo {
  key: string
  label: string
  model: string
  totalTokens: number
  contextTokens: number
  kind: string
  updatedAt: number
  createdAt: number
  aborted: boolean
  channel: string
  sessionId: string
  lastMessage: string
  cost: number
  agentId: string
}

export function toSessionInfo(row: GatewaySessionRow, usage?: GatewaySessionUsage | null): SessionInfo {
  return {
    key: row.key,
    label: row.label || row.displayName || row.derivedTitle || resolveName(row.key),
    model: row.model ? (row.modelProvider ? `${row.modelProvider}/${row.model}` : row.model) : '-',
    totalTokens: usage?.totalTokens || row.totalTokens || 0,
    contextTokens: row.contextTokens || 0,
    kind: row.kind || (row.key.includes('group') ? 'group' : 'direct'),
    updatedAt: row.updatedAt || 0,
    createdAt: row.sessionStartedAt || row.startedAt || usage?.firstActivity || row.updatedAt || 0,
    aborted: row.abortedLastRun === true,
    channel: row.lastChannel || row.chatType || '-',
    sessionId: row.sessionId || '-',
    lastMessage: row.lastMessagePreview || '',
    cost: Math.round(sessionCost(usage) * 100) / 100,
    agentId: row.agentId || 'main',
  }
}

export async function getSessions(): Promise<SessionInfo[]> {
  const [list, usage] = await Promise.all([
    gatewayRequest('sessions.list', { limit: LIST_LIMIT, includeLastMessage: true, includeDerivedTitles: true }) as Promise<{ sessions?: GatewaySessionRow[] }>,
    fetchUsage(USAGE_WINDOW_DAYS).catch(() => null),
  ])
  const rows = list?.sessions ?? []
  const usageByKey = rollupUsageToRows(rows.map((r) => r.key), usage?.sessions ?? [])
  return rows.map((row) => toSessionInfo(row, usageByKey.get(row.key)))
}

export interface SessionMessage {
  role: string
  content: string
  timestamp: string
}

export function toSessionMessage(raw: unknown): SessionMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as { role?: string; content?: unknown; timestamp?: number | string }
  let text = ''
  if (typeof msg.content === 'string') {
    text = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const b of msg.content as Array<Record<string, unknown>>) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text) { text = b.text; break }
      if (['tool_use', 'toolCall', 'toolcall', 'tool_call'].includes(String(b?.type))) { text = '🔧 ' + String(b.name || b.toolName || 'tool'); break }
      if (b?.type === 'tool_result') { text = typeof b.content === 'string' ? b.content : '[tool result]'; break }
    }
  }
  if (!text) return null
  const ts = msg.timestamp
  return {
    role: msg.role || 'unknown',
    content: text.substring(0, 300),
    timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : ts || '',
  }
}

/** Last messages of a session, by session key. */
export async function getSessionMessages(sessionKey: string): Promise<SessionMessage[]> {
  const res = (await gatewayRequest('chat.history', { sessionKey, limit: 30 })) as { messages?: unknown[] } | null
  return (res?.messages ?? []).map(toSessionMessage).filter((m): m is SessionMessage => m !== null)
}

/**
 * Cost breakdown data — shared between the dashboard and the costs page.
 */
export interface CostData {
  total: number
  today: number
  week: number
  perModel: Record<string, number>
  perDay: Record<string, number>
  perSession: Record<string, { cost: number; label: string }>
  /** True when any figure came from list prices rather than OpenClaw's own pricing. */
  estimated: boolean
  windowDays: number
}

export function buildCostData(
  usage: GatewayUsagePayload,
  rows: GatewaySessionRow[],
  opts: { todayKey: string; weekKeys: string[]; windowDays: number },
): CostData {
  const byModel = usage.aggregates?.byModel ?? []
  const perModel: Record<string, number> = {}
  let estimated = false
  for (const e of byModel) {
    const priced = priceModelUsage(e.provider, e.model, e.totals)
    if (priced.estimated) estimated = true
    if (priced.cost > 0) perModel[e.provider ? `${e.provider}/${e.model}` : e.model] = priced.cost
  }

  const daily = priceDaily(usage.aggregates?.modelDaily ?? [], byModel)
  if (daily.estimated) estimated = true
  const perDay: Record<string, number> = {}
  for (const d of usage.aggregates?.daily ?? []) perDay[d.date] = 0
  for (const [date, cost] of Object.entries(daily.perDay)) perDay[date] = (perDay[date] ?? 0) + cost

  const labels = new Map(rows.map((r) => [r.key, r.label || r.displayName || r.derivedTitle || resolveName(r.key)]))
  const perSession: Record<string, { cost: number; label: string }> = {}
  for (const [key, merged] of rollupUsageToRows(rows.map((r) => r.key), usage.sessions ?? [])) {
    const cost = sessionCost(merged)
    if (cost > 0) perSession[key] = { cost: Math.round(cost * 100) / 100, label: labels.get(key) || resolveName(key) }
  }

  const total = Object.values(perModel).reduce((a, b) => a + b, 0)
  return {
    total,
    today: perDay[opts.todayKey] ?? 0,
    week: opts.weekKeys.reduce((sum, k) => sum + (perDay[k] ?? 0), 0),
    perModel,
    perDay,
    perSession,
    estimated,
    windowDays: opts.windowDays,
  }
}

export async function getCostData(): Promise<CostData> {
  const timeZone = serverTimeZone()
  const now = Date.now()
  const [usage, list] = await Promise.all([
    fetchUsage(USAGE_WINDOW_DAYS),
    (gatewayRequest('sessions.list', { limit: LIST_LIMIT, includeDerivedTitles: true }) as Promise<{ sessions?: GatewaySessionRow[] }>).catch(() => null),
  ])
  return buildCostData(usage, list?.sessions ?? [], {
    todayKey: dateKey(now, timeZone),
    weekKeys: Array.from({ length: 7 }, (_, i) => dateKey(now - i * DAY_MS, timeZone)),
    windowDays: USAGE_WINDOW_DAYS,
  })
}
