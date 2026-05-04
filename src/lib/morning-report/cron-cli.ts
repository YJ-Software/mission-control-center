/**
 * OpenClaw Cron — Gateway RPC wrapper
 *
 * Uses the server's existing WebSocket connection to the gateway (via
 * `__gatewayRpc`) to manage cron jobs — the same protocol the official
 * OpenClaw Control UI uses.
 *
 * Falls back to reading ~/.openclaw/cron/jobs.json for list operations
 * when the gateway connection is unavailable.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** Parse a human duration string (e.g. "30s", "5m", "1h", "500ms") to milliseconds */
function parseDurationMs(str: string): number | undefined {
    const m = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i)
    if (!m) return undefined
    const n = parseFloat(m[1])
    switch (m[2].toLowerCase()) {
        case 'ms': return Math.round(n)
        case 's': return Math.round(n * 1000)
        case 'm': return Math.round(n * 60_000)
        case 'h': return Math.round(n * 3_600_000)
        case 'd': return Math.round(n * 86_400_000)
        default: return undefined
    }
}

// ---------------------------------------------------------------------------
// Gateway RPC helper
// ---------------------------------------------------------------------------

/** Call a gateway JSON-RPC method via the server's WebSocket connection. */
function gatewayRpc(method: string, params?: unknown): Promise<unknown> {
    const rpc = (globalThis as any).__gatewayRpc
    if (typeof rpc !== 'function') {
        return Promise.reject(new Error('Gateway RPC not available'))
    }
    return rpc(method, params)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJobInfo {
    id: string
    name: string
    description?: string
    enabled: boolean

    // Schedule
    scheduleKind?: 'cron' | 'at' | 'every'
    schedule?: string       // cron expr
    scheduleAt?: string     // ISO 8601
    scheduleEveryMs?: number  // from Gateway JSON
    timezone?: string
    staggerMs?: number

    // Session & Payload
    sessionTarget?: 'main' | 'isolated'
    payloadKind?: 'agentTurn' | 'systemEvent'
    message?: string
    systemEventText?: string

    // Model
    agentId?: string
    model?: string
    thinking?: string
    timeoutSeconds?: number

    // Delivery
    deliveryMode?: 'announce' | 'webhook' | 'none'
    deliveryChannel?: string
    deliveryTo?: string
    deliveryBestEffort?: boolean

    // Control & State
    deleteAfterRun?: boolean
    nextRunAtMs?: number
    lastRunAtMs?: number
    lastStatus?: string
    lastDurationMs?: number
}

export interface CronAddOptions {
    name: string
    description?: string
    cron?: string
    at?: string
    every?: string        // duration string, e.g. "10m", "1h"
    tz?: string
    stagger?: string
    exact?: boolean
    session?: 'main' | 'isolated'
    message?: string
    systemEvent?: string
    model?: string
    thinking?: string
    timeoutSeconds?: number
    agentId?: string
    deliveryMode?: 'announce' | 'webhook' | 'none'
    announce?: boolean
    noDeliver?: boolean
    channel?: string
    to?: string
    bestEffort?: boolean
    enabled?: boolean
    deleteAfterRun?: boolean
    wake?: 'now' | 'next-heartbeat'
}

export interface CronEditOptions {
    name?: string
    description?: string
    cron?: string
    at?: string
    every?: string        // duration string, e.g. "10m", "1h"
    tz?: string
    stagger?: string
    exact?: boolean
    message?: string
    systemEvent?: string
    model?: string
    thinking?: string
    timeoutSeconds?: number
    agentId?: string
    clearAgent?: boolean
    deliveryMode?: 'announce' | 'webhook' | 'none'
    announce?: boolean
    noDeliver?: boolean
    channel?: string
    to?: string
    bestEffort?: boolean
    enabled?: boolean
    deleteAfterRun?: boolean
    wake?: 'now' | 'next-heartbeat'
}

// ---------------------------------------------------------------------------
// Job mapping helper
// ---------------------------------------------------------------------------

function mapJob(j: any): CronJobInfo {
    return {
        id: j.id,
        name: j.name,
        description: j.description,
        enabled: j.enabled ?? true,
        scheduleKind: j.schedule?.kind,
        schedule: j.schedule?.expr,
        scheduleAt: j.schedule?.at,
        scheduleEveryMs: j.schedule?.everyMs,
        timezone: j.schedule?.tz,
        staggerMs: j.schedule?.staggerMs,
        sessionTarget: j.sessionTarget,
        payloadKind: j.payload?.kind,
        message: j.payload?.message,
        systemEventText: j.payload?.text,
        agentId: j.agentId,
        model: j.payload?.model,
        thinking: j.payload?.thinking,
        timeoutSeconds: j.payload?.timeoutSeconds,
        deliveryMode: j.delivery?.mode,
        deliveryChannel: j.delivery?.channel,
        deliveryTo: j.delivery?.to,
        deliveryBestEffort: j.delivery?.bestEffort,
        deleteAfterRun: j.deleteAfterRun,
        nextRunAtMs: j.state?.nextRunAtMs,
        lastRunAtMs: j.state?.lastRunAtMs,
        lastStatus: j.state?.lastStatus,
        lastDurationMs: j.state?.lastDurationMs,
    }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** Read jobs.json directly as a fallback when gateway RPC is unavailable. */
function readJobsFile(): any[] {
    try {
        const jobsPath = join(homedir(), '.openclaw', 'cron', 'jobs.json')
        const raw = readFileSync(jobsPath, 'utf-8')
        const data = JSON.parse(raw)
        return Array.isArray(data) ? data : (data.jobs ?? data.entries ?? [])
    } catch { return [] }
}

/**
 * List all cron jobs (including disabled ones).
 * Uses gateway RPC (same as official UI), falls back to jobs.json.
 */
export async function cronList(): Promise<CronJobInfo[]> {
    let jobs: any[]
    try {
        const result = await gatewayRpc('cron.list', {
            includeDisabled: true,
            limit: 200,
            offset: 0,
        }) as any
        jobs = result?.jobs ?? []
    } catch {
        // Gateway RPC unavailable — read jobs.json directly (read-only fallback)
        jobs = readJobsFile()
    }
    return jobs.map(mapJob)
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export async function cronAdd(opts: CronAddOptions): Promise<string> {
    const schedule: Record<string, any> = {}
    if (opts.at) {
        schedule.kind = 'at'
        schedule.at = opts.at
    } else if (opts.every) {
        schedule.kind = 'every'
        const everyMs = parseDurationMs(opts.every)
        if (everyMs) schedule.everyMs = everyMs
        else schedule.everyMs = parseInt(opts.every, 10) || 60000
    } else if (opts.cron) {
        schedule.kind = 'cron'
        schedule.expr = opts.cron
    }
    if (schedule.kind === 'cron' || schedule.kind === 'at') {
        schedule.tz = opts.tz ?? 'Asia/Taipei'
    }
    if (opts.stagger) {
        const ms = parseDurationMs(opts.stagger)
        if (ms !== undefined) schedule.staggerMs = ms
    }
    if (opts.exact) schedule.staggerMs = 0

    const payload: Record<string, any> = {}
    if (opts.systemEvent) {
        payload.kind = 'systemEvent'
        payload.text = opts.systemEvent
    } else if (opts.message) {
        payload.kind = 'agentTurn'
        payload.message = opts.message
    }
    if (opts.model) payload.model = opts.model
    if (opts.thinking) payload.thinking = opts.thinking
    if (opts.timeoutSeconds) payload.timeoutSeconds = opts.timeoutSeconds

    const delivery: Record<string, any> = {}
    if (opts.noDeliver || opts.deliveryMode === 'none') {
        delivery.mode = 'none'
    } else if (opts.deliveryMode === 'webhook') {
        delivery.mode = 'webhook'
    } else {
        delivery.mode = 'announce'
        if (opts.channel) delivery.channel = opts.channel
        if (opts.to) delivery.to = opts.to
    }
    if (opts.bestEffort) delivery.bestEffort = true

    const params: Record<string, any> = {
        name: opts.name,
        schedule,
        payload,
        delivery,
        sessionTarget: opts.session ?? 'isolated',
        wakeMode: opts.wake ?? 'now',
        enabled: opts.enabled !== false,
    }
    if (opts.description) params.description = opts.description
    if (opts.agentId) params.agentId = opts.agentId
    if (opts.deleteAfterRun) params.deleteAfterRun = true

    const result = await gatewayRpc('cron.add', params) as any
    return result?.id ?? result?.jobId ?? ''
}

// ---------------------------------------------------------------------------
// Edit (partial update via cron.update)
// ---------------------------------------------------------------------------

export async function cronEdit(jobId: string, opts: CronEditOptions): Promise<void> {
    const patch: Record<string, any> = {}

    if (opts.name !== undefined) patch.name = opts.name
    if (opts.description !== undefined) patch.description = opts.description

    // Schedule fields
    const schedule: Record<string, any> = {}
    let hasSchedule = false
    if (opts.cron !== undefined) { schedule.kind = 'cron'; schedule.expr = opts.cron; hasSchedule = true }
    if (opts.at !== undefined) { schedule.kind = 'at'; schedule.at = opts.at; hasSchedule = true }
    if (opts.every !== undefined) {
        schedule.kind = 'every'
        const everyMs = parseDurationMs(opts.every)
        if (everyMs) schedule.everyMs = everyMs
        else schedule.everyMs = parseInt(opts.every, 10) || 60000
        hasSchedule = true
    }
    if (opts.tz !== undefined && schedule.kind !== 'every') { schedule.tz = opts.tz; hasSchedule = true }
    if (opts.stagger !== undefined) {
        const ms = parseDurationMs(opts.stagger)
        if (ms !== undefined) { schedule.staggerMs = ms; hasSchedule = true }
    }
    if (opts.exact) { schedule.staggerMs = 0; hasSchedule = true }
    if (hasSchedule) patch.schedule = schedule

    // Payload
    const payload: Record<string, any> = {}
    let hasPayload = false
    if (opts.systemEvent !== undefined) { payload.kind = 'systemEvent'; payload.text = opts.systemEvent; hasPayload = true }
    else if (opts.message !== undefined) { payload.kind = 'agentTurn'; payload.message = opts.message; hasPayload = true }
    if (opts.model !== undefined) { payload.model = opts.model; hasPayload = true }
    if (opts.thinking !== undefined) { payload.thinking = opts.thinking; hasPayload = true }
    if (opts.timeoutSeconds !== undefined) { payload.timeoutSeconds = opts.timeoutSeconds; hasPayload = true }
    if (hasPayload) patch.payload = payload

    // Delivery
    const delivery: Record<string, any> = {}
    let hasDelivery = false
    if (opts.noDeliver || opts.deliveryMode === 'none') { delivery.mode = 'none'; hasDelivery = true }
    else if (opts.announce === true || opts.deliveryMode === 'announce') { delivery.mode = 'announce'; hasDelivery = true }
    if (opts.channel) { delivery.channel = opts.channel; hasDelivery = true }
    if (opts.to) { delivery.to = opts.to; hasDelivery = true }
    if (opts.bestEffort) { delivery.bestEffort = true; hasDelivery = true }
    if (hasDelivery) patch.delivery = delivery

    // Agent
    if (opts.clearAgent) patch.agentId = null
    else if (opts.agentId !== undefined) patch.agentId = opts.agentId

    // Control
    if (opts.enabled !== undefined) patch.enabled = opts.enabled
    if (opts.deleteAfterRun !== undefined) patch.deleteAfterRun = opts.deleteAfterRun
    if (opts.wake !== undefined) patch.wakeMode = opts.wake

    await gatewayRpc('cron.update', { id: jobId, patch })
}

// ---------------------------------------------------------------------------
// Enable / Disable
// ---------------------------------------------------------------------------

export async function cronEnable(jobId: string): Promise<void> {
    await gatewayRpc('cron.update', { id: jobId, patch: { enabled: true } })
}

export async function cronDisable(jobId: string): Promise<void> {
    await gatewayRpc('cron.update', { id: jobId, patch: { enabled: false } })
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export async function cronRemove(jobId: string): Promise<void> {
    await gatewayRpc('cron.remove', { id: jobId })
}

// ---------------------------------------------------------------------------
// Run (for debugging)
// ---------------------------------------------------------------------------

export async function cronRun(jobId: string, mode: 'force' | 'due' = 'force'): Promise<string> {
    const result = await gatewayRpc('cron.run', { id: jobId, mode }) as any
    return typeof result === 'string' ? result : JSON.stringify(result ?? '')
}

// ---------------------------------------------------------------------------
// Runs history
// ---------------------------------------------------------------------------

export async function cronRuns(jobId: string, limit: number = 20): Promise<any[]> {
    try {
        const result = await gatewayRpc('cron.runs', {
            scope: 'job',
            id: jobId,
            limit,
            offset: 0,
        }) as any
        return result?.entries ?? []
    } catch {
        return []
    }
}
