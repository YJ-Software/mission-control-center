/** Translate native Hermes REST and SSE into the browser's existing Gateway protocol. */
import { setTimeout as delay } from 'node:timers/promises'
import type { ApprovalDecision } from '../openclaw/interactions'
import { HermesApprovals } from './hermes-approvals'
import type { HermesRuntime } from './hermes'

export type Frame = Record<string, unknown>
export type EmitFrame = (frame: Frame) => void

export interface ChatBridgeOptions {
  baseUrl: string
  apiKey: string
  runtime: HermesRuntime
  emit: EmitFrame
  /** Bounds every non-streaming request. */
  timeoutMs?: number
  streamTimeoutMs?: number
  reconcileTimeoutMs?: number
  pollIntervalMs?: number
  approvalTimeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 15_000
const APPROVAL_TIMEOUT_MS = 10 * 60_000
const STREAM_TIMEOUT_MS = 15 * 60_000
const RECONCILE_TIMEOUT_MS = 12 * 60_000
const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'cancelled'])
const ACTIVE_RUN_STATES = new Set(['queued', 'running', 'stopping', 'waiting_for_approval'])

interface RunState {
  text: string
  notice?: string
  controller: AbortController
}

/** Methods the browser sends that Hermes must answer instead of the Gateway. */
const HANDLED = new Set([
  'chat.send',
  'chat.abort',
  'chat.history',
  'sessions.list',
  'models.list',
  'agents.list',
  'sessions.patch',
  'sessions.usage.logs',
  'question.list',
  'exec.approval.list',
  'exec.approval.resolve',
  'plugin.approval.list',
])

export class UnsupportedOnHermes extends Error {
  constructor(what: string) {
    super(`${what} is not supported by the Hermes backend`)
    this.name = 'UnsupportedOnHermes'
  }
}

export class HermesChatBridge {
  private seq = 0
  /** run_id -> session key, so stream frames can be addressed to the right chat. */
  private runSessions = new Map<string, string>()
  private readonly fetchImpl: typeof fetch
  private readonly approvals: HermesApprovals

  constructor(private readonly opts: ChatBridgeOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.approvals = new HermesApprovals({
      timeoutMs: opts.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
      emit: (event, payload) => opts.emit({ type: 'event', event, payload }),
      respond: async (runId, requestId, choice) => {
        await this.http(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
          method: 'POST',
          body: JSON.stringify({ choice, request_id: requestId }),
        })
      },
    })
  }

  static handles(method: string): boolean {
    return HANDLED.has(method)
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'chat.send':
        return this.chatSend(params)
      case 'chat.abort':
        return this.chatAbort(params)
      case 'chat.history':
        return this.chatHistory(params)
      case 'sessions.list':
        return { sessions: await this.opts.runtime.listSessions({ limit: 200 }) }
      case 'models.list':
        return this.modelsList()
      case 'agents.list':
        return { agents: await this.opts.runtime.listAgents() }
      case 'sessions.patch':
        return this.sessionsPatch(params)
      case 'sessions.usage.logs':
        return { entries: [] }
      case 'question.list':
        return { questions: [] }
      case 'exec.approval.list':
        return { approvals: this.approvals.list() }
      case 'exec.approval.resolve':
        return this.approvals.resolve(String(params.id ?? ''), params.decision as ApprovalDecision)
      case 'plugin.approval.list':
        return { approvals: [] }
      default:
        throw new UnsupportedOnHermes(method)
    }
  }

  private async http(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    if (!res.ok) {
      const err = new Error(`Hermes ${path}: HTTP ${res.status}`) as Error & { status: number; approvalInactive?: boolean }
      err.status = res.status
      if (res.status === 409 && path.endsWith('/approval')) {
        const body = await res.json().catch(() => null) as { code?: string; error?: { code?: string } } | null
        err.approvalInactive = (body?.error?.code ?? body?.code) === 'approval_not_active'
      }
      throw err
    }
    return res
  }

  private async modelsList(): Promise<unknown> {
    const res = await this.http('/v1/models')
    const body = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
    return {
      models: (body.data ?? []).map((m) => ({
        id: m.id ?? '',
        name: m.id ?? '',
        provider: m.owned_by ?? 'hermes',
      })),
    }
  }

  /** Only the title is writable on a Hermes session; anything else must say so. */
  private async sessionsPatch(params: Record<string, unknown>): Promise<unknown> {
    const key = String(params.key ?? params.sessionKey ?? '')
    const unsupported = Object.keys(params).filter((k) => !['key', 'sessionKey', 'title'].includes(k))
    if (unsupported.length) throw new UnsupportedOnHermes(`sessions.patch ${unsupported.join(', ')}`)
    if (!key) throw new Error('sessions.patch requires a session key')
    await this.http(`/api/sessions/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: params.title }),
    })
    return { ok: true }
  }

  private async chatHistory(params: Record<string, unknown>): Promise<unknown> {
    const key = String(params.sessionKey ?? '')
    if (!key) return { messages: [] }
    const limit = typeof params.limit === 'number' ? params.limit : 200
    // A session that does not exist yet is an empty transcript (the chat panel
    // opens on a key before the first turn creates it) — but ONLY a 404 means
    // that. Swallowing every error would render a dead backend as "no messages",
    // the same failure the cron contract exists to prevent.
    try {
      const messages = await this.opts.runtime.getHistory(key, { limit })
      return { messages }
    } catch (err) {
      if ((err as { status?: number }).status === 404) return { messages: [] }
      throw err
    }
  }

  private async chatAbort(params: Record<string, unknown>): Promise<unknown> {
    // The browser only learns the runId from the first delta, so Stop pressed
    // during a long tool call arrives with none. Fall back to this session's
    // active run — otherwise the button silently does nothing exactly when the
    // user most wants it.
    const sessionKey = String(params.sessionKey ?? '')
    const runId = String(params.runId ?? '') || this.activeRunFor(sessionKey)
    if (!runId) return { ok: false }
    await this.http(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: '{}' })
    return { ok: true }
  }

  /** Newest still-running run for a session, if any. */
  private activeRunFor(sessionKey: string): string {
    for (const [runId, key] of [...this.runSessions].reverse()) {
      if (key === sessionKey) return runId
    }
    return ''
  }

  /**
   * Start a turn. Returns as soon as Hermes accepts it — the reply arrives as
   * `chat` event frames, exactly as the Gateway's own `chat.send` behaves.
   */
  private async chatSend(params: Record<string, unknown>): Promise<unknown> {
    const sessionKey = String(params.sessionKey ?? '')
    const message = String(params.message ?? '')
    // The composer can attach images. `/v1/runs` takes text only, so accepting
    // them silently would drop the attachment with no error and leave the user
    // wondering why the agent ignored their screenshot.
    if (Array.isArray(params.attachments) && params.attachments.length > 0) {
      throw new UnsupportedOnHermes('chat.send attachments')
    }
    const res = await this.http('/v1/runs', {
      method: 'POST',
      ...(typeof params.idempotencyKey === 'string' && params.idempotencyKey
        ? { headers: { 'Idempotency-Key': params.idempotencyKey } }
        : {}),
      body: JSON.stringify({ input: message, ...(sessionKey ? { session_id: sessionKey } : {}) }),
    })
    const body = (await res.json()) as { run_id?: string; replayed?: boolean }
    const runId = body.run_id ?? ''
    if (!runId) throw new Error('Hermes did not return a run_id')
    // Hermes has a single subscriber queue per run. Retries must share the pump.
    if (!this.runSessions.has(runId)) void this.pump(runId, sessionKey, body.replayed === true)
    return { ok: true, runId }
  }

  private emitChat(payload: Record<string, unknown>): void {
    this.opts.emit({ type: 'event', event: 'chat', payload })
  }

  /** Consume the single upstream stream, then use run GET to recover from any disconnect. */
  async pump(runId: string, sessionKey: string, replayed = false): Promise<void> {
    const path = `/v1/runs/${encodeURIComponent(runId)}`
    const state: RunState = { text: '', controller: new AbortController() }
    this.runSessions.set(runId, sessionKey)
    const tools = new Map<string, string[]>()
    try {
      if (!replayed) {
        try {
          const signal = AbortSignal.any([
            state.controller.signal,
            AbortSignal.timeout(this.opts.streamTimeoutMs ?? STREAM_TIMEOUT_MS),
          ])
          const res = await this.http(`${path}/events`, { signal })
          for await (const evt of readSse(res)) {
            if (evt.event === 'message.delta') {
              state.text += String(evt.delta ?? '')
              this.emitChat(this.chatPayload(runId, sessionKey, 'delta', this.withNotice(state)))
            } else if (evt.event === 'tool.started' || evt.event === 'tool.completed') {
              this.emitTool(runId, sessionKey, evt, tools)
            } else if (evt.event === 'approval.request') {
              this.approvals.request(runId, sessionKey, evt, (accepted) => {
                state.notice = accepted
                  ? 'Hermes 審核逾時，已自動拒絕。'
                  : 'Hermes 審核逾時，無法送出拒絕，正在停止執行。'
                this.emitChat(this.chatPayload(runId, sessionKey, 'delta', this.withNotice(state)))
                if (!accepted) state.controller.abort()
              })
            } else if (evt.event === 'approval.responded') {
              this.approvals.responded(runId, evt.request_id)
            } else if (typeof evt.event === 'string' && evt.event.startsWith('run.')) {
              const status = evt.event.slice(4)
              if (TERMINAL_RUN_STATES.has(status)) {
                await this.approvals.waitForExpiry(runId)
                this.emitTerminal(runId, sessionKey, status, evt, state)
                return
              }
            }
          }
        } catch { /* the run status endpoint remains available after the SSE queue is consumed */ }
      }
      await this.reconcile(path, runId, sessionKey, state)
    } finally {
      this.approvals.clearRun(runId)
      this.runSessions.delete(runId)
    }
  }

  private withNotice(state: RunState, text = state.text): string {
    return [state.notice, text].filter(Boolean).join('\n\n')
  }

  private emitTool(runId: string, sessionKey: string, evt: Record<string, unknown>, tools: Map<string, string[]>): void {
    const name = String(evt.tool ?? 'tool')
    const pending = tools.get(name) ?? []
    const started = evt.event === 'tool.started'
    // Hermes supplies no call ID. Pair with the oldest unmatched start for this name.
    const toolCallId = started ? `${runId}:tool:${++this.seq}` : pending.shift()
    if (!toolCallId) return
    if (started) {
      pending.push(toolCallId)
      tools.set(name, pending)
    } else if (!pending.length) {
      tools.delete(name)
    }
    this.emitChat({
      stream: 'tool', runId, sessionKey, ts: Date.now(),
      data: {
        toolCallId, name, phase: started ? 'start' : 'result',
        ...(started ? { args: evt.preview } : { result: evt.error ? 'error' : 'ok' }),
      },
    })
  }

  private emitTerminal(runId: string, sessionKey: string, status: string, run: Record<string, unknown>, state: RunState): void {
    if (status === 'completed') {
      this.emitChat(this.chatPayload(runId, sessionKey, 'final', this.withNotice(state, String(run.output ?? state.text))))
    } else if (status === 'cancelled') {
      this.emitChat(this.chatPayload(runId, sessionKey, 'aborted', this.withNotice(state)))
    } else if (status === 'failed') {
      this.emitError(runId, sessionKey, this.withNotice(state, String(run.error ?? 'Hermes run failed')))
    }
  }

  private emitError(runId: string, sessionKey: string, errorMessage: string): void {
    this.emitChat({ ...this.chatPayload(runId, sessionKey, 'error', ''), errorMessage })
  }

  private async reconcile(path: string, runId: string, sessionKey: string, state: RunState): Promise<void> {
    const deadline = Date.now() + (this.opts.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS)
    let waitingSince: number | undefined
    let lastStatus: string | undefined
    while (Date.now() < deadline && !state.controller.signal.aborted) {
      try {
        const timeout = Math.min(deadline - Date.now(), this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        const res = await this.http(path, { signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(timeout)]) })
        const run = await res.json() as Record<string, unknown>
        const status = String(run.status ?? '')
        lastStatus = status
        if (TERMINAL_RUN_STATES.has(status)) {
          await this.approvals.waitForExpiry(runId)
          this.emitTerminal(runId, sessionKey, status, run, state)
          return
        }
        if (status === 'waiting_for_approval' && !this.approvals.hasPending(runId)) {
          // Run GET has no request ID. A missed prompt can only be stopped.
          waitingSince ??= Date.now()
          if (Date.now() - waitingSince >= (this.opts.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS)) break
        } else {
          waitingSince = undefined
        }
      } catch (err) {
        if ((err as { status?: number }).status === 404) break
      }
      const remaining = deadline - Date.now()
      if (remaining > 0) {
        await delay(Math.min(remaining, this.opts.pollIntervalMs ?? 1_000), undefined, { signal: state.controller.signal }).catch(() => {})
      }
    }

    await this.approvals.waitForExpiry(runId)
    if (state.controller.signal.aborted || lastStatus === 'waiting_for_approval') {
      try {
        await this.http(`${path}/stop`, { method: 'POST', body: '{}' })
        this.emitError(runId, sessionKey, this.withNotice(state, 'Hermes 審核逾時，已要求停止執行。'))
      } catch {
        this.emitError(runId, sessionKey, this.withNotice(state, 'Hermes 審核逾時，無法停止執行。'))
      }
      return
    }
    const detail = lastStatus && ACTIVE_RUN_STATES.has(lastStatus) ? ` (last status: ${lastStatus})` : ''
    this.emitError(runId, sessionKey, this.withNotice(state, `Hermes run result could not be confirmed${detail}`))
  }

  private chatPayload(runId: string, sessionKey: string, state: string, text: string): Record<string, unknown> {
    return {
      runId,
      sessionKey,
      seq: ++this.seq,
      state,
      message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: Date.now() },
    }
  }
}

/**
 * What `/ws` should do with one browser frame.
 *
 * Extracted from server.ts so the routing decision is testable: a malformed
 * frame must not take the socket down, and an RPC the backend cannot serve must
 * be ANSWERED (the browser's sendRpc waits 30s before giving up, so a dropped
 * frame stalls the UI rather than failing it).
 *
 * `null` means "not ours — forward to the Gateway verbatim", which is the whole
 * of the OpenClaw path.
 */
export function routeBrowserFrame(
  raw: string,
  bridge: HermesChatBridge | null,
): { id: string; method: string; params: Record<string, unknown> } | null {
  if (!bridge) return null
  let frame: unknown
  try {
    frame = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof frame !== 'object' || frame === null) return null
  const f = frame as { type?: unknown; id?: unknown; method?: unknown; params?: unknown }
  if (f.type !== 'req' || typeof f.method !== 'string') return null
  return {
    id: String(f.id ?? ''),
    method: f.method,
    params: (typeof f.params === 'object' && f.params !== null ? f.params : {}) as Record<string, unknown>,
  }
}

/** The `{type:'res'}` frame the browser's pending-RPC map is waiting for. */
export function rpcResponseFrame(id: string, result: { ok: true; payload: unknown } | { ok: false; error: unknown }): Frame {
  return result.ok
    ? { type: 'res', id, ok: true, payload: result.payload }
    : {
        type: 'res',
        id,
        ok: false,
        error: { message: result.error instanceof Error ? result.error.message : String(result.error) },
      }
}

/** Minimal SSE reader: yields each `data:` payload parsed as JSON. */
export async function* readSse(res: Response): AsyncGenerator<Record<string, unknown>> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const json = line.slice(5).trim()
        if (!json) continue
        try {
          yield JSON.parse(json) as Record<string, unknown>
        } catch {
          // A partial or non-JSON line is not worth killing the stream over.
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
