import { describe, it, expect, vi } from 'vitest'
import { HermesChatBridge, UnsupportedOnHermes, type ChatBridgeOptions } from '@/lib/agent-runtime/chat-bridge'
import { HermesRuntime } from '@/lib/agent-runtime/hermes'
import { applyInteractionEvent, approvalResolveRequest, seedInteractions } from '@/lib/openclaw/interactions'
import native from './fixtures/hermes-0.21.5-runs.json'

/**
 * The bridge exists so no React file has to change. These pin the frame shapes
 * `websocket.tsx` demultiplexes and `use-chat-session.ts` consumes — if they
 * drift, the chat window breaks in ways no type checker would catch.
 */

const BASE = 'http://hermes.test'

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function makeBridge(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>, options: Partial<ChatBridgeOptions> = {}) {
  const frames: Record<string, unknown>[] = []
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(BASE, '')
    const key = Object.keys(routes).find((r) => path.startsWith(r))
    return key ? routes[key](init) : new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  const bridge = new HermesChatBridge({
    baseUrl: BASE,
    apiKey: 'k',
    // The runtime MUST get the same stub. It used to keep the global fetch, so
    // anything delegated to it (chat.history, sessions.list, agents.list) quietly
    // hit the network and the test asserted on a DNS failure instead of on Hermes.
    runtime: new HermesRuntime({ baseUrl: BASE, apiKey: 'k', fetchImpl }),
    emit: (f) => frames.push(f),
    fetchImpl,
    ...options,
  })
  return { bridge, frames, fetchImpl }
}

const chatPayloads = (frames: Record<string, unknown>[]) =>
  frames
    .filter((f) => f.event === 'chat')
    .map((f) => f.payload as Record<string, unknown>)
    .filter((p) => p.stream !== 'tool')

describe('HermesChatBridge streaming', () => {
  it('accumulates deltas — the browser expects the full text, not fragments', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () =>
        sseResponse([
          { event: 'message.delta', delta: 'Hel' },
          { event: 'message.delta', delta: 'lo ' },
          { event: 'message.delta', delta: 'world' },
          { event: 'run.completed', output: 'Hello world' },
        ]),
    })

    await bridge.pump('r1', 'sess-1')

    const texts = chatPayloads(frames).map(
      (p) => ((p.message as any).content[0].text as string),
    )
    expect(texts).toEqual(['Hel', 'Hello ', 'Hello world', 'Hello world'])
  })

  it('emits frames in the exact shape websocket.tsx demultiplexes', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () => sseResponse([{ event: 'run.completed', output: 'done' }]),
    })

    await bridge.pump('r1', 'sess-1')

    expect(frames[0]).toMatchObject({ type: 'event', event: 'chat' })
    const p = frames[0].payload as Record<string, unknown>
    expect(p).toMatchObject({ runId: 'r1', sessionKey: 'sess-1', state: 'final' })
    expect(typeof p.seq).toBe('number')
    expect((p.message as any).role).toBe('assistant')
    expect((p.message as any).content[0]).toMatchObject({ type: 'text', text: 'done' })
  })

  it('gives tool events a synthetic id so the UI does not drop them', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () =>
        sseResponse([
          { event: 'tool.started', tool: 'terminal', preview: 'echo hi' },
          { event: 'tool.completed', tool: 'terminal', error: false },
          { event: 'run.completed', output: 'hi' },
        ]),
    })

    await bridge.pump('r1', 'sess-1')

    const tools = frames
      .map((f) => f.payload as Record<string, unknown>)
      .filter((p) => p.stream === 'tool')
      .map((p) => p.data as Record<string, unknown>)

    expect(tools).toHaveLength(2)
    expect(tools[0].toolCallId).toBeTruthy()
    // start and completion must share an id or the UI shows two orphan calls
    expect(tools[1].toolCallId).toBe(tools[0].toolCallId)
    expect(tools.map((t) => t.phase)).toEqual(['start', 'result'])
  })

  it('maps run.failed to an error frame with a message', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () => sseResponse([{ event: 'run.failed', error: 'provider auth failed' }]),
    })

    await bridge.pump('r1', 'sess-1')

    expect(chatPayloads(frames)[0]).toMatchObject({ state: 'error', errorMessage: 'provider auth failed' })
  })

  it('maps run.cancelled to aborted, keeping the partial text', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () =>
        sseResponse([{ event: 'message.delta', delta: 'partial' }, { event: 'run.cancelled' }]),
    })

    await bridge.pump('r1', 'sess-1')

    const last = chatPayloads(frames).at(-1)!
    expect(last.state).toBe('aborted')
    expect((last.message as any).content[0].text).toBe('partial')
  })

  it('turns a stream failure into an error frame rather than a silent hang', async () => {
    const { bridge, frames } = makeBridge({})
    await bridge.pump('r1', 'sess-1')

    expect(chatPayloads(frames)[0]).toMatchObject({ state: 'error' })
  })

  /**
   * The spinner bug: the browser sets isStreaming on send and clears it only on
   * a terminal frame. A stream that just ends — no run.completed, no error —
   * used to emit nothing at all, leaving the chat window turning forever.
   */
  it('closes the turn when the stream ends with no terminal event', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () => sseResponse([{ event: 'message.delta', delta: 'partial' }]),
      '/v1/runs/r1': () => json({ status: 'completed', output: 'partial' }),
    })

    await bridge.pump('r1', 'sess-1')

    const last = chatPayloads(frames).at(-1)!
    expect(last.state).toBe('final')
    expect((last.message as any).content[0].text).toBe('partial')
  })

  it('reports the run as failed when reconciling finds a failure', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () => sseResponse([]),
      '/v1/runs/r1': () => json({ status: 'failed', error: 'provider down' }),
    })

    await bridge.pump('r1', 'sess-1')

    expect(chatPayloads(frames).at(-1)).toMatchObject({ state: 'error', errorMessage: 'provider down' })
  })

  it('still closes the turn when even the reconcile call fails', async () => {
    const { bridge, frames } = makeBridge({
      '/v1/runs/r1/events': () => sseResponse([{ event: 'message.delta', delta: 'half' }]),
      // no route for GET /v1/runs/r1 -> 404
    })

    await bridge.pump('r1', 'sess-1')

    const last = chatPayloads(frames).at(-1)!
    expect(last.state).toBe('error')
    expect(String(last.errorMessage)).toMatch(/run result could not be confirmed/)
  })
})

describe('HermesChatBridge RPC surface', () => {
  it('claims exactly the methods the chat UI sends', () => {
    for (const m of ['chat.send', 'chat.abort', 'chat.history', 'sessions.list', 'models.list', 'agents.list', 'question.list', 'exec.approval.list', 'exec.approval.resolve', 'plugin.approval.list', 'sessions.patch', 'sessions.usage.logs']) {
      expect(HermesChatBridge.handles(m)).toBe(true)
    }
    expect(HermesChatBridge.handles('cron.list')).toBe(false)
  })

  it('starts with empty approval and unsupported interaction lists', async () => {
    const { bridge } = makeBridge({})
    await expect(bridge.call('question.list')).resolves.toEqual({ questions: [] })
    await expect(bridge.call('exec.approval.list')).resolves.toEqual({ approvals: [] })
    await expect(bridge.call('plugin.approval.list')).resolves.toEqual({ approvals: [] })
  })

  it('shapes models.list the way useModelsList reads it', async () => {
    const { bridge } = makeBridge({ '/v1/models': () => json({ data: [{ id: 'hermes-agent', owned_by: 'hermes' }] }) })
    await expect(bridge.call('models.list')).resolves.toEqual({
      models: [{ id: 'hermes-agent', name: 'hermes-agent', provider: 'hermes' }],
    })
  })

  it('refuses a sessions.patch it cannot honour instead of pretending', async () => {
    const { bridge } = makeBridge({})
    await expect(bridge.call('sessions.patch', { key: 's1', model: 'glm-5' })).rejects.toThrow(UnsupportedOnHermes)
  })

  it('treats an unknown session (404) as an empty transcript', async () => {
    // The stub answers 404 for unrouted paths — the real "no such session" case.
    const { bridge } = makeBridge({})
    await expect(bridge.call('chat.history', { sessionKey: 'nope' })).resolves.toEqual({ messages: [] })
  })

  it('does NOT report a dead backend as an empty transcript', async () => {
    // The bug this replaces: every error became `{messages: []}`, so an outage
    // looked exactly like a fresh chat.
    const { bridge } = makeBridge({
      '/api/sessions': () => new Response('boom', { status: 500 }),
    })
    await expect(bridge.call('chat.history', { sessionKey: 's1' })).rejects.toThrow(/500/)
  })

  it('refuses attachments instead of dropping them silently', async () => {
    const { bridge } = makeBridge({ '/v1/runs': () => json({ run_id: 'r1' }) })
    await expect(
      bridge.call('chat.send', { sessionKey: 's1', message: 'look', attachments: [{ dataUrl: 'data:image/png;base64,AA' }] }),
    ).rejects.toThrow(UnsupportedOnHermes)
  })

  it('stops a run the browser has no runId for yet', async () => {
    const stopped: string[] = []
    const { bridge } = makeBridge({
      '/v1/runs/r7/stop': () => { stopped.push('r7'); return json({ ok: true }) },
      '/v1/runs/r7/events': () => sseResponse([]),
      '/v1/runs/r7': () => json({ status: 'completed', output: '' }),
      '/v1/runs': () => json({ run_id: 'r7' }),
    })

    await bridge.call('chat.send', { sessionKey: 's1', message: 'long one' })
    // Stop pressed before the first delta: no runId, only the session.
    await expect(bridge.call('chat.abort', { sessionKey: 's1' })).resolves.toEqual({ ok: true })
    expect(stopped).toEqual(['r7'])
  })

  it('starts a run and returns immediately with its id', async () => {
    const { bridge } = makeBridge({
      '/v1/runs/': () => sseResponse([{ event: 'run.completed', output: 'ok' }]),
      '/v1/runs': () => json({ run_id: 'r9' }),
    })

    await expect(bridge.call('chat.send', { sessionKey: 's1', message: 'hi' })).resolves.toMatchObject({
      ok: true,
      runId: 'r9',
    })
  })

  it('rejects a method it does not handle', async () => {
    const { bridge } = makeBridge({})
    await expect(bridge.call('cron.add')).rejects.toThrow(UnsupportedOnHermes)
  })
})

describe('native Hermes 0.21.5 run contract', () => {
  const run = '/v1/runs/fixture-run'
  const session = 'fixture-session'
  const request = native.approvalRequest

  function liveSse(initial: Record<string, unknown>[] = []) {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const emit = (event: Record<string, unknown>) =>
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller
        for (const event of initial) emit(event)
      },
    }))
    return { response, emit, close: () => stream.close() }
  }

  it('pairs two same-name starts FIFO and consumes each completion once', async () => {
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: () => sseResponse([
        native.toolStart, native.toolStart, native.toolComplete, native.toolComplete, native.toolComplete, native.terminal,
      ]),
    })
    await bridge.pump('fixture-run', session)
    const tools = frames.flatMap((f) => {
      const p = f.payload as { stream?: string; data?: { toolCallId: string; phase: string } }
      return p.stream === 'tool' ? [p.data!] : []
    })
    expect(tools.map(({ phase }) => phase)).toEqual(['start', 'start', 'result', 'result'])
    const ids = tools.map(({ toolCallId }) => toolCallId)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids.slice(2)).toEqual(ids.slice(0, 2))
  })

  it.each(['body error', 'EOF', '404'])('reconciles after %s and never calls an active run final', async (ending) => {
    const answers = ['queued', 'running', 'stopping', native.waiting.status, 'completed']
    const states: string[] = []
    const sse = vi.fn(() => {
      if (ending === 'EOF') return sseResponse([])
      if (ending === '404') return new Response(null, { status: native.streamReopenStatus })
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error('SSE disconnected')) } }))
    })
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: sse,
      [run]: () => {
        expect(chatPayloads(frames)).toEqual([])
        const status = answers.shift()!
        states.push(status)
        return json({ status, output: native.terminal.output })
      },
    }, { pollIntervalMs: 1, reconcileTimeoutMs: 500 })
    await bridge.pump('fixture-run', session)
    expect(sse).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['queued', 'running', 'stopping', native.waiting.status, 'completed'])
    expect(chatPayloads(frames).map((frame) => frame.state)).toEqual(['final'])
  })

  it('ends reconciliation with a visible error when status stays running', async () => {
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: () => sseResponse([]),
      [run]: () => json({ status: 'running' }),
    }, { pollIntervalMs: 1, reconcileTimeoutMs: 25 })
    await bridge.pump('fixture-run', session)
    expect(chatPayloads(frames)).toEqual([expect.objectContaining({ state: 'error', errorMessage: expect.stringContaining('running') })])
  })

  it('bounds a hanging SSE and reconciles after cancellation', async () => {
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: (init) => Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true })
        },
      }))),
      [run]: () => json({ status: 'completed', output: native.terminal.output }),
    }, { streamTimeoutMs: 10, reconcileTimeoutMs: 500 })
    await bridge.pump('fixture-run', session)
    expect(chatPayloads(frames)).toEqual([expect.objectContaining({ state: 'final' })])
  })

  it('passes Idempotency-Key and keeps one subscriber on retried submission', async () => {
    const stream = liveSse()
    const open = vi.fn(() => stream.response)
    let submitted = 0
    const post = vi.fn((init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('fixture-browser-key')
      expect(JSON.parse(String(init?.body))).toEqual({ input: 'hello', session_id: session })
      return new Response(JSON.stringify({ ...native.submitted, replayed: submitted++ > 0 }), { status: native.replay.status })
    })
    const { bridge, frames } = makeBridge({ [`${run}/events`]: open, '/v1/runs': post })
    const params = { sessionKey: session, message: 'hello', idempotencyKey: 'fixture-browser-key' }
    await expect(bridge.call('chat.send', params)).resolves.toMatchObject({ runId: 'fixture-run' })
    await expect(bridge.call('chat.send', params)).resolves.toMatchObject({ runId: 'fixture-run' })
    expect(post).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledTimes(1)
    stream.emit(native.terminal)
    stream.close()
    await vi.waitFor(() => expect(chatPayloads(frames).map((p) => p.state)).toEqual(['final']))
  })

  it.each([['allow-once', 'once'], ['allow-always', 'always'], ['deny', 'deny']] as const)(
    'surfaces pending exec approval in the existing interaction UI and sends %s as %s',
    async (decision, choice) => {
      const stream = liveSse([request])
      const answer = vi.fn((init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ request_id: request.request_id, choice })
        return json({ ...native.approvalResponse, choice })
      })
      const { bridge, frames } = makeBridge({
        [`${run}/events`]: () => stream.response,
        [`${run}/approval`]: answer,
      })
      const pump = bridge.pump('fixture-run', session)
      await vi.waitFor(() => expect(frames[0]?.event).toBe('exec.approval.requested'))
      const item = applyInteractionEvent([], String(frames[0].event), frames[0].payload)[0]
      expect(item).toMatchObject({
        sessionKey: session, command: request.command, allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      })
      const listed = await bridge.call('exec.approval.list')
      expect(seedInteractions({ exec: listed })).toEqual([item])
      expect(item.expiresAtMs - item.createdAtMs).toBe(600_000)
      if (item.kind !== 'approval') throw new Error('Missing exec approval')
      const rpc = approvalResolveRequest(item, decision)
      await expect(bridge.call(rpc.method, rpc.params)).resolves.toEqual({ ok: true })
      expect(answer).toHaveBeenCalledTimes(1)
      expect(applyInteractionEvent([item], String(frames[1].event), frames[1].payload)).toEqual([])
      await expect(bridge.call('exec.approval.list')).resolves.toEqual({ approvals: [] })
      stream.emit(native.terminal)
      stream.close()
      await pump
      expect(chatPayloads(frames)).toEqual([expect.objectContaining({ state: 'final' })])
    },
  )

  it('removes an approval when the native endpoint reports approval_not_active', async () => {
    const stream = liveSse([{ ...request, allow_permanent: false }])
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: () => stream.response,
      [`${run}/approval`]: () => new Response(JSON.stringify(native.approvalInactive.body), { status: native.approvalInactive.status }),
    })
    const pump = bridge.pump('fixture-run', session)
    await vi.waitFor(() => expect(frames[0]?.event).toBe('exec.approval.requested'))
    const [item] = seedInteractions({ exec: await bridge.call('exec.approval.list') })
    if (item.kind !== 'approval') throw new Error('Missing exec approval')
    expect(item.allowedDecisions).toEqual(['allow-once', 'deny'])
    const rpc = approvalResolveRequest(item, 'deny')
    await expect(bridge.call(rpc.method, rpc.params)).rejects.toThrow(/409/)
    await expect(bridge.call('exec.approval.list')).resolves.toEqual({ approvals: [] })
    stream.emit(native.terminal)
    stream.close()
    await pump
  })

  it('auto-denies after the bound and keeps the notice when completion races the POST response', async () => {
    const stream = liveSse([request])
    const answer = vi.fn((init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ request_id: request.request_id, choice: 'deny' })
      stream.emit({ event: 'approval.responded', request_id: request.request_id })
      stream.emit(native.terminal)
      stream.close()
      return json(native.approvalResponse)
    })
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: () => stream.response,
      [`${run}/approval`]: answer,
    }, { approvalTimeoutMs: 10 })

    const pump = bridge.pump('fixture-run', session)
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1))
    await pump
    const last = chatPayloads(frames).at(-1)
    expect(last).toMatchObject({
      state: 'final',
      message: { content: [{ text: expect.stringContaining('審核逾時，已自動拒絕') }] },
    })
  })

  it('stops a run with a missed approval and reports the timeout in chat', async () => {
    const stop = vi.fn(() => json({ status: 'stopping' }))
    const { bridge, frames } = makeBridge({
      [`${run}/events`]: () => sseResponse([]),
      [`${run}/stop`]: stop,
      [run]: () => json(native.waiting),
    }, { approvalTimeoutMs: 12, reconcileTimeoutMs: 500, pollIntervalMs: 1 })
    await bridge.pump('fixture-run', session)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(chatPayloads(frames)).toEqual([expect.objectContaining({ state: 'error', errorMessage: expect.stringContaining('已要求停止執行') })])
  })
})
