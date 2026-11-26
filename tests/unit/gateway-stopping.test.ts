import { processMocks } from './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gatewayActionTimeout, OPENCLAW_GATEWAY_UNIT, parseSystemdDurationMs } from '@/lib/openclaw/gateway-systemd'
import { readGatewayStop } from '@/lib/openclaw/gateway-stopping'

const since = Date.parse('2026-11-26T01:23:00Z')
const state = {
  LoadState: 'loaded',
  ActiveState: 'deactivating',
  TimeoutStopUSec: '5min 30s',
  ActiveExitTimestamp: 'Thu 2026-11-26 01:23:00.000000 UTC',
  InactiveExitTimestamp: 'Thu 2026-11-26 01:00:00.000000 UTC',
  StateChangeTimestamp: 'Thu 2026-11-26 01:23:10.000000 UTC',
}
const guard = processMocks.execFile.getMockImplementation()!
let sandbox: ReturnType<typeof stubHermesHome>

beforeEach(() => {
  sandbox = stubHermesHome()
  vi.stubEnv('MCC_AGENT_RUNTIME', 'openclaw')
  processMocks.execFile.mockReset().mockImplementation(guard)
})
afterEach(() => {
  sandbox.cleanup()
  vi.unstubAllEnvs()
})

function showUnit(overrides: Record<string, string> = {}) {
  processMocks.execFile.mockImplementationOnce((bin, args, options, callback) => {
    expect(bin).toBe('systemctl')
    expect(args.slice(0, 3)).toEqual(['--user', 'show', OPENCLAW_GATEWAY_UNIT])
    expect(options.timeout).toBe(5000)
    callback(null, Object.entries({ ...state, ...overrides }).map(([key, value]) => `${key}=${value}`).join('\n'), '')
  })
}

function journal(message: string) {
  processMocks.execFile.mockImplementationOnce((bin, args, _options, callback) => {
    expect(bin).toBe('journalctl')
    expect(args.slice(0, 5)).toEqual(['--user', '--boot', '-u', OPENCLAW_GATEWAY_UNIT, '--since'])
    expect(args[5]).toBe(`@${(since / 1000).toFixed(3)}`)
    expect(new RegExp(args[7]).test('[telegram] [default] channel stop exceeded 5000ms after abort')).toBe(true)
    expect(new RegExp(args[7]).test('[discord] channel stop exceeded 5000ms after abort')).toBe(false)
    callback(null, message, '')
  })
}

describe('systemd gateway stop inspection', () => {
  it.each([20_000, 30_000])('does not inspect the journal at %sms of deactivation', async elapsed => {
    showUnit()
    expect(await readGatewayStop(OPENCLAW_GATEWAY_UNIT, null, () => since + elapsed)).toBeNull()
    expect(processMocks.execFile).toHaveBeenCalledOnce()
  })

  it('uses the current stop journal and the remaining timeout after a substate change', async () => {
    showUnit()
    journal('[telegram] channel stop exceeded 5000ms after abort')
    const stop = await readGatewayStop(OPENCLAW_GATEWAY_UNIT, null, () => since + 100_000)
    expect(stop).toEqual({ since, telegram: true, remainingMinutes: 4 })
    showUnit()
    expect(await readGatewayStop(OPENCLAW_GATEWAY_UNIT, stop, () => since + 310_000))
      .toEqual({ since, telegram: true, remainingMinutes: 1 })
  })

  it('reports a generic stop when the current stop has no Telegram match', async () => {
    showUnit({ TimeoutStopUSec: '2min' })
    journal('')
    expect(await readGatewayStop(OPENCLAW_GATEWAY_UNIT, { since: since - 500_000, telegram: true }, () => since + 65_000))
      .toEqual({ since, telegram: false, remainingMinutes: 1 })
  })

  it('clears the stop when the unit leaves deactivation', async () => {
    showUnit({ ActiveState: 'activating' })
    expect(await readGatewayStop(OPENCLAW_GATEWAY_UNIT, { since, telegram: true }, () => since + 65_000)).toBeNull()
  })

  it('shows an unbounded stop with no estimate', async () => {
    showUnit({ TimeoutStopUSec: 'infinity' })
    journal('')
    expect(await readGatewayStop(OPENCLAW_GATEWAY_UNIT, null, () => since + 65_000))
      .toEqual({ since, telegram: false, remainingMinutes: undefined })
  })
})

describe('gateway command budgets', () => {
  it('keeps native restore and CLI actions alive through the systemd stop', () => {
    expect(gatewayActionTimeout('stop', 120_000, state)).toBe(335_000)
    expect(gatewayActionTimeout('restart', 15_000, { ...state, TimeoutStartUSec: '30s' })).toBe(370_000)
    expect(gatewayActionTimeout('restart', 120_000, state)).toBe(455_000)
    expect(gatewayActionTimeout('start', 60_000, state)).toBe(395_000)
    expect(gatewayActionTimeout('start', 60_000, { ...state, ActiveState: 'inactive' })).toBe(60_000)
  })

  it('keeps the existing wait when timing is unavailable and leaves infinite stops to systemd', () => {
    expect(gatewayActionTimeout('restart', 60_000, {})).toBe(60_000)
    expect(gatewayActionTimeout('restart', 60_000, { TimeoutStopUSec: 'infinity' })).toBe(0)
    expect(parseSystemdDurationMs('1h 2min 3s 4ms 500us')).toBe(3_723_004.5)
  })
})
