/**
 * OpenClaw backend for {@link AgentRuntime}.
 *
 * A thin adapter over the Gateway's JSON-RPC: it moves the RPC calls (and their
 * version quirks) out of `sessions.ts` and `cron-cli.ts` without changing any of
 * the mapping logic those modules already own. The row and usage shapes ARE the
 * Gateway's, so most methods are a pass-through — that is deliberate: the
 * neutral types were chosen to match this backend so the incumbent path stays
 * boring and the burden of translation falls on newer backends.
 */

import { gatewayRequest } from '@/lib/gateway-rpc'
import type {
  AgentRuntime,
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

const LIST_LIMIT = 200

/**
 * The Gateway's `cron.list` job shape, narrowed to what this adapter reads.
 * Mirrors `cron-cli.ts`'s `mapJob()`: schedule details sit under `schedule`,
 * run state under `state` with millisecond suffixes.
 */
interface GatewayCronJob {
  id?: string
  name?: string
  enabled?: boolean
  schedule?: { kind?: string; expr?: string; at?: string; everyMs?: number; tz?: string }
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastStatus?: string; lastDurationMs?: number }
}

export class OpenClawRuntime implements AgentRuntime {
  readonly id = 'openclaw' as const

  async listAgents(): Promise<RuntimeAgent[]> {
    // Some Gateway builds answer with a bare array rather than {agents:[...]},
    // and an agent may carry only `name` — api/agents/route.ts handles both, so
    // this must too or the agent list silently empties on those builds.
    const res = (await gatewayRequest('agents.list', {})) as
      | { agents?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
      | null
    const list = Array.isArray(res) ? res : (res?.agents ?? [])
    return list.map((a) => ({
      id: String(a.id ?? a.name ?? ''),
      name: typeof a.name === 'string' ? a.name : undefined,
      status: typeof a.status === 'string' ? a.status : 'idle',
    }))
  }

  async listSessions(opts?: {
    limit?: number
    includeLastMessage?: boolean
    includeDerivedTitles?: boolean
  }): Promise<RuntimeSessionRow[]> {
    // Only forward what the caller asked for. Defaulting these to `true` would
    // add an `includeLastMessage` to the cost path, which never requested it —
    // a behaviour change smuggled in by an adapter is exactly what this
    // refactor must not do.
    const params: Record<string, unknown> = { limit: opts?.limit ?? LIST_LIMIT }
    if (opts?.includeLastMessage !== undefined) params.includeLastMessage = opts.includeLastMessage
    if (opts?.includeDerivedTitles !== undefined) params.includeDerivedTitles = opts.includeDerivedTitles
    const res = (await gatewayRequest('sessions.list', params)) as { sessions?: RuntimeSessionRow[] } | null
    return res?.sessions ?? []
  }

  async getHistory(sessionKey: string, opts?: { limit?: number }): Promise<RuntimeMessage[]> {
    const res = (await gatewayRequest('chat.history', {
      sessionKey,
      limit: opts?.limit ?? 30,
    })) as { messages?: RuntimeMessage[] } | null
    return res?.messages ?? []
  }

  /**
   * Usage for a calendar window.
   *
   * Older Gateways reject the calendar-mode parameters and bucket by UTC day
   * instead; retry without them rather than losing the whole report. Kept here
   * so callers never have to know which Gateway they are talking to.
   */
  async getUsage(range: UsageRange): Promise<RuntimeUsageReport> {
    const params = {
      startDate: range.startDate,
      endDate: range.endDate,
      agentScope: range.agentScope ?? 'all',
      limit: range.sessionLimit ?? 1000,
    }
    try {
      return (await gatewayRequest('sessions.usage', {
        ...params,
        mode: 'specific',
        timeZone: range.timeZone,
      })) as RuntimeUsageReport
    } catch {
      return (await gatewayRequest('sessions.usage', params)) as RuntimeUsageReport
    }
  }

  /**
   * Scheduled jobs. Deliberately does NOT catch: a failure here must surface,
   * never render as an empty schedule. See AgentRuntime.listCronJobs.
   */
  async listCronJobs(opts?: { includeDisabled?: boolean; limit?: number }): Promise<RuntimeCronJob[]> {
    const res = (await gatewayRequest('cron.list', {
      includeDisabled: opts?.includeDisabled ?? true,
      limit: opts?.limit ?? LIST_LIMIT,
      offset: 0,
    })) as { jobs?: GatewayCronJob[] } | null
    // Field names mirror cron-cli.ts's mapJob(), which is the authority on this
    // wire shape: the schedule lives under `schedule.expr` and every run-state
    // field is nested under `state` with an explicit `Ms` suffix.
    return (res?.jobs ?? []).map((j) => ({
      id: String(j.id ?? ''),
      name: String(j.name ?? j.id ?? ''),
      enabled: j.enabled ?? true,
      schedule: j.schedule?.expr,
      lastStatus: j.state?.lastStatus,
      lastRunAt: j.state?.lastRunAtMs,
      nextRunAt: j.state?.nextRunAtMs,
    }))
  }

  async getCronRuns(jobId: string, limit = 20): Promise<RuntimeCronRun[] | null> {
    // The Gateway returns these under `entries`, not `runs` (see cron-cli.ts:400).
    const res = (await gatewayRequest('cron.runs', {
      scope: 'job',
      id: jobId,
      limit,
      offset: 0,
    })) as { entries?: RuntimeCronRun[] } | null
    return res?.entries ?? []
  }

  /** `cron.status` doubles as the Gateway liveness probe (see morning-report/openclaw.ts). */
  async health(): Promise<RuntimeHealth> {
    try {
      await gatewayRequest('cron.status')
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }
}

export type { RuntimeSessionUsage }
