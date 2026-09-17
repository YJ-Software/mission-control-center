/**
 * Backend-neutral read surface for an agent runtime.
 *
 * MCC was written against OpenClaw's Gateway JSON-RPC. This interface is the
 * seam that lets a second backend (Hermes Agent, a REST/SSE API) serve the same
 * dashboard reads. Only READ paths live here: writes (chat.send, sessions.patch,
 * cron.add/update/run, approval resolves) stay backend-specific for now because
 * their payloads encode OpenClaw's own job/delivery model, which Hermes does not
 * share.
 *
 * The usage types are deliberately re-exported from `usage-pricing` rather than
 * redefined: `priceModelUsage`, `priceDaily`, `rollupUsageToRows` and
 * `buildCostData` then keep working against any backend with zero changes.
 */

import type { GatewayUsageTotals, ModelDailyEntry, ModelTotalsEntry } from '@/lib/usage-pricing'

export type { GatewayUsageTotals, ModelDailyEntry, ModelTotalsEntry }

/**
 * One agent. OpenClaw has many; Hermes has no such concept and synthesises one.
 *
 * Same caveat as {@link RuntimeCronJob}: `/api/agents` additionally serves
 * `lastActive`, `model` and `identity` to the AI-team and cron-form views, so it
 * keeps its own OpenClaw-specific path rather than narrowing to this shape.
 */
export interface RuntimeAgent {
  id: string
  name?: string
  status?: string
}

/**
 * A session row as the dashboard needs it.
 *
 * `key` is OPAQUE — never parse it. OpenClaw's grammar (`agent:<id>:cron:<job>`)
 * is an implementation detail of that backend; an adapter that knows the grammar
 * supplies `agentId` and `label` instead. Matches OpenClaw's `sessions.list` row
 * so its adapter is a pass-through.
 */
export interface RuntimeSessionRow {
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

export interface RuntimeSessionUsage extends GatewayUsageTotals {
  firstActivity?: number
  modelUsage?: ModelTotalsEntry[]
}

/**
 * Usage over a calendar window.
 *
 * `missingCostEntries` is load-bearing, not cosmetic: `priceModelUsage` trusts a
 * backend's own `totalCost` only when it is > 0 AND nothing is missing. A backend
 * that does not price its usage (Hermes reports `estimated_cost_usd: 0` /
 * `actual_cost_usd: null`) MUST report a non-zero count, or every figure silently
 * renders as $0 instead of falling back to list-price estimation.
 */
export interface RuntimeUsageReport {
  sessions?: Array<{ key: string; usage: RuntimeSessionUsage | null }>
  /**
   * True when the per-day figures are attributed rather than measured — the
   * backend reports only per-session totals, so a long-lived session's spend
   * lands entirely on one day. The cost UI should mark such figures as
   * estimates instead of showing them as exact history.
   */
  approximateDaily?: boolean
  aggregates?: {
    byModel?: ModelTotalsEntry[]
    modelDaily?: ModelDailyEntry[]
    daily?: Array<{ date: string }>
  }
}

export interface RuntimeMessage {
  role?: string
  content?: unknown
  timestamp?: number | string
  /** Set on a tool-result row so the reader can pair it with its call. */
  toolCallId?: string
}

/**
 * The cross-backend SUBSET of a scheduled job — enough for a dashboard panel
 * that must work against either backend.
 *
 * It is NOT a replacement for `CronJobInfo` in `cron-cli.ts`, which carries ~25
 * fields (schedule.kind/at/everyMs/tz/staggerMs, payload.kind/message/model,
 * delivery.mode/channel/to, sessionTarget, …) and is what the cron management
 * UI actually reads — measured: 26 distinct fields across `src/components/cron`
 * and `src/app/api/cron`. Routing `cronList()` through this type would silently
 * drop ~19 of them and quietly break the editor. Job CREATION and EDITING encode
 * OpenClaw's own scheduling model and stay OpenClaw-specific by design.
 */
export interface RuntimeCronJob {
  id: string
  name: string
  enabled: boolean
  schedule?: string
  lastStatus?: string
  lastRunAt?: number
  nextRunAt?: number
  lastError?: string
}

export interface RuntimeHealth {
  ok: boolean
  version?: string | null
}

export interface UsageRange {
  startDate: string
  endDate: string
  timeZone: string
  agentScope?: string
  sessionLimit?: number
}

export interface AgentRuntime {
  readonly id: 'openclaw' | 'hermes'

  listAgents(): Promise<RuntimeAgent[]>

  listSessions(opts?: {
    limit?: number
    includeLastMessage?: boolean
    includeDerivedTitles?: boolean
  }): Promise<RuntimeSessionRow[]>

  getHistory(sessionKey: string, opts?: { limit?: number }): Promise<RuntimeMessage[]>

  getUsage(range: UsageRange): Promise<RuntimeUsageReport>

  /**
   * Scheduled jobs.
   *
   * MUST throw when the backend cannot be reached. Returning `[]` on failure is
   * forbidden: on 2026-09-01 an OpenClaw upgrade broke `cron.list` for ~18h and
   * the swallowed error rendered as "no cron jobs", which is indistinguishable
   * from a genuinely empty schedule and invited operators to recreate jobs that
   * already existed. See the cron rule in CLAUDE.md.
   */
  listCronJobs(opts?: { includeDisabled?: boolean; limit?: number }): Promise<RuntimeCronJob[]>

  /**
   * Per-job run history. `null` means the backend has no such concept, which the
   * UI must render as "unavailable" — distinct from `[]`, "never run".
   * Hermes exposes only `last_run_at` / `last_status` on the job itself.
   */
  getCronRuns(jobId: string, limit?: number): Promise<RuntimeCronRun[] | null>

  health(): Promise<RuntimeHealth>
}

export interface RuntimeCronRun {
  startedAt?: number
  finishedAt?: number
  status?: string
  durationMs?: number
  error?: string
}
