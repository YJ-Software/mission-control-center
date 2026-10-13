import { describe, it, expect } from 'vitest'
import { classifyGatewayClose, routeBrowserFrameToGateway } from '@/lib/gateway/routing'
import { describeCliError, openclawCliEnv, CLI_ERROR_STDERR_MAX } from '@/lib/gateway/openclaw-cli'
import { isGatewayReady, type GatewayLinkState } from '@/lib/gateway/link-status'

const req = JSON.stringify({ type: 'req', id: 'rpc-1-abc', method: 'chat.send', params: {} })

describe('routeBrowserFrameToGateway', () => {
  it('forwards only when the socket is open AND the handshake finished', () => {
    expect(routeBrowserFrameToGateway(req, { socketOpen: true, state: 'linked' })).toEqual({ kind: 'forward' })
  })

  it('regression: never forwards during the handshake (OpenClaw would close us with "invalid handshake")', () => {
    const r = routeBrowserFrameToGateway(req, { socketOpen: true, state: 'connecting' })
    expect(r.kind).toBe('reply')
    // Not even non-request frames like the browser's client-connect hello.
    expect(routeBrowserFrameToGateway(JSON.stringify({ type: 'client-connect' }), { socketOpen: true, state: 'connecting' }))
      .toEqual({ kind: 'drop' })
  })

  it('answers requests at once with the link state while not linked', () => {
    const states: GatewayLinkState[] = ['connecting', 'pairing', 'pairing-retry', 'auth-failed', 'offline', 'linked']
    for (const state of states) {
      const r = routeBrowserFrameToGateway(req, { socketOpen: false, state })
      expect(r.kind).toBe('reply')
      if (r.kind !== 'reply') continue
      expect(JSON.parse(r.frame)).toEqual({
        type: 'res', id: 'rpc-1-abc', ok: false, error: { message: `Gateway not connected (${state})` },
      })
    }
  })

  it('keeps numeric ids and drops what it cannot answer', () => {
    const r = routeBrowserFrameToGateway(JSON.stringify({ type: 'req', id: 7, method: 'x' }), { socketOpen: false, state: 'offline' })
    expect(r.kind === 'reply' && JSON.parse(r.frame).id).toBe(7)
    expect(routeBrowserFrameToGateway('not json', { socketOpen: false, state: 'offline' })).toEqual({ kind: 'drop' })
    expect(routeBrowserFrameToGateway(JSON.stringify({ type: 'req' }), { socketOpen: false, state: 'offline' })).toEqual({ kind: 'drop' })
  })
})

describe('classifyGatewayClose', () => {
  it('routes every pairing requirement to PairingRetry', () => {
    expect(classifyGatewayClose(1008, 'pairing required: not-paired (requestId: abc)')).toBe('pairing')
    expect(classifyGatewayClose(1008, 'pairing required: scope-upgrade (requestId: abc)')).toBe('pairing')
  })

  it('treats token / identity rejections as auth failures', () => {
    expect(classifyGatewayClose(1008, 'unauthorized: gateway token mismatch')).toBe('auth')
    expect(classifyGatewayClose(1008, 'device signature expired')).toBe('auth')
    expect(classifyGatewayClose(4001, 'identity required')).toBe('auth')
  })

  it('does not call a handshake protocol slip an auth failure', () => {
    expect(classifyGatewayClose(1008, 'invalid handshake: first request must be connect')).toBe('disconnect')
  })

  it('treats restarts and drops as plain disconnects', () => {
    expect(classifyGatewayClose(1006, '')).toBe('disconnect')
    expect(classifyGatewayClose(1012, 'service restart')).toBe('disconnect')
    expect(classifyGatewayClose(1001, 'going away')).toBe('disconnect')
  })

  it('recognises a gateway that is still booting (1013 / "starting")', () => {
    expect(classifyGatewayClose(1013, 'gateway starting')).toBe('starting')
    expect(classifyGatewayClose(1013, '')).toBe('starting')
    expect(classifyGatewayClose(1011, 'gateway starting')).toBe('starting')
    expect(classifyGatewayClose(1000, 'Starting up')).toBe('starting')
    // Pairing / credential rejections keep priority over a stray "starting".
    expect(classifyGatewayClose(1008, 'pairing required: starting')).toBe('pairing')
    expect(classifyGatewayClose(1008, 'unauthorized while starting')).toBe('auth')
    // Word match only: "restarting" is a plain restart, not the boot state.
    expect(classifyGatewayClose(1012, 'restarting')).toBe('disconnect')
  })
})

describe('openclawCliEnv', () => {
  it('puts the running node first on PATH (nvm openclaw is a `#!/usr/bin/env node` script)', () => {
    const env = openclawCliEnv({ PATH: '/usr/bin:/bin', HOME: '/h', OPENCLAW_X: '1' }, '/h/.nvm/versions/node/v24.1.0/bin/node')
    expect(env.PATH).toBe('/h/.nvm/versions/node/v24.1.0/bin:/usr/bin:/bin')
    expect(env.HOME).toBe('/h')
    expect(env.OPENCLAW_X).toBe('1')
  })

  it('does not duplicate the node dir or keep empty entries', () => {
    const env = openclawCliEnv({ PATH: '/usr/bin::/opt/node/bin' }, '/opt/node/bin/node')
    expect(env.PATH).toBe('/opt/node/bin:/usr/bin')
    expect(openclawCliEnv({} as Record<string, string | undefined>, '/opt/node/bin/node').PATH).toBe('/opt/node/bin')
  })
})

describe('describeCliError', () => {
  it('reports exit code, signal, timeout-kill and stderr on one line', () => {
    const err = Object.assign(new Error('Command failed: openclaw devices list\nboom'), {
      code: 1, signal: null, killed: false, stderr: "Error: Couldn't connect to OpenClaw\n  at gateway 127.0.0.1:18789\n",
    })
    expect(describeCliError('devices list', err)).toBe(
      'devices list failed: exit=1 signal=null killed=false stderr="Error: Couldn\'t connect to OpenClaw at gateway 127.0.0.1:18789"',
    )
  })

  it('distinguishes our 10s timeout kill', () => {
    const err = Object.assign(new Error('Command failed'), { code: null, signal: 'SIGTERM', killed: true, stderr: '' })
    expect(describeCliError('devices approve', err)).toMatch(/exit=null signal=SIGTERM killed=true/)
  })

  it('truncates stderr and strips clack box drawing / ANSI', () => {
    const stderr = '\x1b[33m┌  Doctor warnings ─────┐\x1b[0m\n│ ' + 'x'.repeat(2_000) + '\n'
    const out = describeCliError('devices list', { code: 1, stderr })
    expect(out).not.toMatch(/[\n┌│─]|\x1b/)
    const quoted = out.slice(out.indexOf('stderr="') + 8, -1)
    expect(quoted.length).toBe(CLI_ERROR_STDERR_MAX + 1) // + ellipsis
    expect(quoted.startsWith('Doctor warnings x')).toBe(true)
  })

  it('reports ENOENT and aborts', () => {
    expect(describeCliError('devices list', Object.assign(new Error('spawn openclaw ENOENT'), { code: 'ENOENT' })))
      .toBe('devices list failed: exit=ENOENT signal=null killed=false stderr="spawn openclaw ENOENT"')
    expect(describeCliError('devices list', Object.assign(new Error('aborted'), { name: 'AbortError' })))
      .toBe('devices list aborted')
  })
})

describe('isGatewayReady', () => {
  const base = { since: 1, runtime: 'openclaw' as const }
  it('is true only when the tab is connected and MCC is linked (so hooks re-fetch on re-link)', () => {
    expect(isGatewayReady({ ...base, state: 'linked' }, true)).toBe(true)
    expect(isGatewayReady({ ...base, state: 'linked' }, false)).toBe(false)
    expect(isGatewayReady(null, true)).toBe(false)
    for (const state of ['connecting', 'pairing', 'pairing-retry', 'auth-failed', 'offline'] as const) {
      expect(isGatewayReady({ ...base, state }, true)).toBe(false)
    }
  })

  it('is true in Hermes mode once connected — there is no Gateway to wait for', () => {
    expect(isGatewayReady({ since: 1, runtime: 'hermes', state: 'offline' }, true)).toBe(true)
  })
})
