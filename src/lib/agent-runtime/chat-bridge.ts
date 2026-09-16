/**
 * Speaks the browser's Gateway dialect on Hermes' behalf.
 *
 * MCC's chat UI talks one protocol: RPC frames over `/ws` and
 * `{type:'event', event:'chat', payload}` broadcasts back. That contract is
 * consumed by `use-chat-session.ts` and `websocket.tsx` — the most intricate,
 * most-used code in the app. Rather than refactor those, this translates
 * Hermes' REST + SSE into the same frames, server-side, so not a single React
 * file changes and the OpenClaw path stays byte-identical.
 *
 * Measured quirks this has to absorb (all found by running the real container,
 * not by reading its docs):
 * - MCC's `delta` carries the FULL text so far (`use-chat-session.ts` assigns,
 *   not appends); Hermes emits incremental fragments. Accumulate before emitting.
 * - Hermes tool events carry no tool-call id, but `ToolStreamPayload` is keyed
 *   by one and drops events without it. Synthesize a stable id per run+tool.
 * - Hermes has no questions and no pending approvals at all, so those lists
 *   answer empty — the interaction panel then renders nothing instead of erroring.
 */

import type { HermesRuntime } from './hermes'

export type Frame = Record<string, unknown>
export type EmitFrame = (frame: Frame) => void

export interface ChatBridgeOptions {
  baseUrl: string
  apiKey: string
  runtime: HermesRuntime
  emit: EmitFrame
  fetchImpl?: typeof fetch
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

  constructor(private readonly opts: ChatBridgeOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
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
      // Hermes keeps no per-session usage log, and has neither questions nor
      // pending approvals (both measured). Empty is the truthful answer; the
      // consumers treat it as "nothing to show".
      case 'sessions.usage.logs':
        return { entries: [] }
      case 'question.list':
        return { questions: [] }
      case 'exec.approval.list':
      case 'plugin.approval.list':
        return { approvals: [] }
      default:
        throw new UnsupportedOnHermes(method)
    }
  }

  private async http(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
    })
    if (!res.ok) throw new Error(`Hermes ${path}: HTTP ${res.status}`)
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
    // A session that does not exist yet is an empty transcript, not an error:
    // the chat panel opens on a key before the first turn creates it.
    try {
      const messages = await this.opts.runtime.getHistory(key, { limit })
      return { messages }
    } catch {
      return { messages: [] }
    }
  }

  private async chatAbort(params: Record<string, unknown>): Promise<unknown> {
    const runId = String(params.runId ?? '')
    if (!runId) return { ok: false }
    await this.http(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: '{}' })
    return { ok: true }
  }

  /**
   * Start a turn. Returns as soon as Hermes accepts it — the reply arrives as
   * `chat` event frames, exactly as the Gateway's own `chat.send` behaves.
   */
  private async chatSend(params: Record<string, unknown>): Promise<unknown> {
    const sessionKey = String(params.sessionKey ?? '')
    const message = String(params.message ?? '')
    const res = await this.http('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ input: message, ...(sessionKey ? { session_id: sessionKey } : {}) }),
    })
    const body = (await res.json()) as { run_id?: string }
    const runId = body.run_id ?? ''
    if (!runId) throw new Error('Hermes did not return a run_id')
    this.runSessions.set(runId, sessionKey)
    // Deliberately not awaited: the RPC must return now, like the Gateway's does.
    void this.pump(runId, sessionKey)
    return { ok: true, runId }
  }

  private emitChat(payload: Record<string, unknown>): void {
    this.opts.emit({ type: 'event', event: 'chat', payload })
  }

  /** Consume one run's SSE stream and translate it into chat frames. */
  async pump(runId: string, sessionKey: string): Promise<void> {
    let text = ''
    const toolIds = new Map<string, string>()
    try {
      const res = await this.http(`/v1/runs/${encodeURIComponent(runId)}/events`)
      for await (const evt of readSse(res)) {
        const kind = String(evt.event ?? '')
        if (kind === 'message.delta') {
          // Hermes sends fragments; the browser expects the running total.
          text += String(evt.delta ?? '')
          this.emitChat(this.chatPayload(runId, sessionKey, 'delta', text))
        } else if (kind === 'tool.started' || kind === 'tool.completed') {
          const tool = String(evt.tool ?? 'tool')
          // No id on the wire: one per (run, tool) so start and completion pair up.
          const key = `${runId}:${tool}`
          if (!toolIds.has(key)) toolIds.set(key, `${key}:${++this.seq}`)
          this.emitChat({
            stream: 'tool',
            runId,
            sessionKey,
            ts: Date.now(),
            data: {
              toolCallId: toolIds.get(key)!,
              name: tool,
              phase: kind === 'tool.started' ? 'start' : 'result',
              ...(kind === 'tool.started' ? { args: evt.preview } : { result: evt.error ? 'error' : 'ok' }),
            },
          })
        } else if (kind === 'run.completed') {
          this.emitChat(this.chatPayload(runId, sessionKey, 'final', String(evt.output ?? text)))
          return
        } else if (kind === 'run.failed') {
          this.emitChat({
            ...this.chatPayload(runId, sessionKey, 'error', ''),
            errorMessage: String(evt.error ?? 'run failed'),
          })
          return
        } else if (kind === 'run.cancelled') {
          this.emitChat(this.chatPayload(runId, sessionKey, 'aborted', text))
          return
        }
      }
    } catch (err) {
      this.emitChat({
        ...this.chatPayload(runId, sessionKey, 'error', ''),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.runSessions.delete(runId)
    }
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
}
