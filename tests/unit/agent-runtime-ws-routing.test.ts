import { describe, it, expect } from 'vitest'
import { routeBrowserFrame, rpcResponseFrame, HermesChatBridge } from '@/lib/agent-runtime/chat-bridge'
import { HermesRuntime } from '@/lib/agent-runtime/hermes'

/**
 * The `/ws` routing decision, lifted out of server.ts so it can be tested
 * without booting the app — booting a second MCC would share the live
 * dashboard's SQLite file, which is not a risk worth taking for a test.
 */

const bridge = new HermesChatBridge({
  baseUrl: 'http://hermes.test',
  apiKey: 'k',
  runtime: new HermesRuntime({ baseUrl: 'http://hermes.test', apiKey: 'k' }),
  emit: () => {},
})

const req = (method: string, params?: unknown) =>
  JSON.stringify({ type: 'req', id: 'rpc-1', method, ...(params ? { params } : {}) })

describe('routeBrowserFrame', () => {
  it('forwards everything to the Gateway when no bridge is configured', () => {
    // The OpenClaw path: not one frame is intercepted.
    expect(routeBrowserFrame(req('chat.send'), null)).toBeNull()
  })

  it('claims an RPC request when the bridge is active', () => {
    expect(routeBrowserFrame(req('chat.send', { message: 'hi' }), bridge)).toEqual({
      id: 'rpc-1',
      method: 'chat.send',
      params: { message: 'hi' },
    })
  })

  it('survives a malformed frame instead of taking the socket down', () => {
    expect(routeBrowserFrame('{not json', bridge)).toBeNull()
    expect(routeBrowserFrame('null', bridge)).toBeNull()
    expect(routeBrowserFrame('"a string"', bridge)).toBeNull()
  })

  it('leaves non-RPC frames alone (client-connect, pings, …)', () => {
    expect(routeBrowserFrame(JSON.stringify({ type: 'client-connect' }), bridge)).toBeNull()
    expect(routeBrowserFrame(JSON.stringify({ type: 'req' }), bridge)).toBeNull()
  })

  it('defaults missing params to an empty object', () => {
    expect(routeBrowserFrame(req('question.list'), bridge)?.params).toEqual({})
  })

  it('claims methods it cannot serve too — so they fail fast instead of hanging', () => {
    // bridge.call() rejects with UnsupportedOnHermes, which becomes an ok:false
    // response. Forwarding to a Gateway that may not exist would time out at 30s.
    expect(routeBrowserFrame(req('cron.add'), bridge)?.method).toBe('cron.add')
  })
})

describe('rpcResponseFrame', () => {
  it('builds the success frame the browser matches by id', () => {
    expect(rpcResponseFrame('rpc-1', { ok: true, payload: { messages: [] } })).toEqual({
      type: 'res',
      id: 'rpc-1',
      ok: true,
      payload: { messages: [] },
    })
  })

  it('turns an Error into the message shape websocket.tsx reads', () => {
    expect(rpcResponseFrame('rpc-2', { ok: false, error: new Error('nope') })).toEqual({
      type: 'res',
      id: 'rpc-2',
      ok: false,
      error: { message: 'nope' },
    })
  })

  it('stringifies a non-Error rejection rather than emitting undefined', () => {
    expect(rpcResponseFrame('rpc-3', { ok: false, error: 'plain string' })).toMatchObject({
      error: { message: 'plain string' },
    })
  })
})
