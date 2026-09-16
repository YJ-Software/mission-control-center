import { describe, it, expect, vi } from 'vitest'
import { HermesChatBridge, UnsupportedOnHermes } from '@/lib/agent-runtime/chat-bridge'
import { HermesRuntime } from '@/lib/agent-runtime/hermes'

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

function makeBridge(routes: Record<string, () => Response>) {
  const frames: Record<string, unknown>[] = []
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const path = String(url).replace(BASE, '')
    const key = Object.keys(routes).find((r) => path.startsWith(r))
    return key ? routes[key]() : new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  const bridge = new HermesChatBridge({
    baseUrl: BASE,
    apiKey: 'k',
    runtime: new HermesRuntime({ baseUrl: BASE, apiKey: 'k' }),
    emit: (f) => frames.push(f),
    fetchImpl,
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
})

describe('HermesChatBridge RPC surface', () => {
  it('claims exactly the methods the chat UI sends', () => {
    for (const m of ['chat.send', 'chat.abort', 'chat.history', 'sessions.list', 'models.list', 'agents.list', 'question.list', 'exec.approval.list', 'plugin.approval.list', 'sessions.patch', 'sessions.usage.logs']) {
      expect(HermesChatBridge.handles(m)).toBe(true)
    }
    expect(HermesChatBridge.handles('cron.list')).toBe(false)
  })

  it('answers the interaction lists empty — Hermes has neither', async () => {
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

  it('treats an unknown session as an empty transcript, not an error', async () => {
    const { bridge } = makeBridge({})
    await expect(bridge.call('chat.history', { sessionKey: 'nope' })).resolves.toEqual({ messages: [] })
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
