import { processMocks } from './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gatewayActionTimeout, MAX_GATEWAY_WAIT_MS, OPENCLAW_GATEWAY_UNIT, parseSystemdDurationMs, stopStartedAt,
} from '@/lib/openclaw/gateway-systemd'
import { monitorGatewayStop } from '@/lib/openclaw/gateway-stopping'

const since = Date.parse('2026-11-26T01:23:00Z')
const stopping = {
  LoadState: 'loaded',
  ActiveState: 'deactivating',
  TimeoutStopUSec: '5min 30s',
  ActiveExitTimestamp: 'Thu 2026-11-26 01:23:00.000000 UTC',
  InactiveExitTimestamp: 'Thu 2026-11-26 01:00:00.000000 UTC',
  StateChangeTimestamp: 'Thu 2026-11-26 01:23:10.000000 UTC',
}
const overflow = '999999999999999999999999999999h'
const guard = processMocks.execFile.getMockImplementation()!
let sandbox: ReturnType<typeof stubHermesHome>
let stopMonitor: (() => void) | undefined

beforeEach(() => {
  sandbox = stubHermesHome()
  vi.stubEnv('MCC_AGENT_RUNTIME', 'openclaw')
  processMocks.execFile.mockReset().mockImplementation(guard)
  vi.useFakeTimers()
  vi.setSystemTime(since + 65_000)
})

afterEach(() => {
  stopMonitor?.()
  stopMonitor = undefined
  vi.useRealTimers()
  sandbox.cleanup()
  vi.unstubAllEnvs()
})

function showUnit(overrides: Record<string, string> = {}, error: Error | null = null) {
  processMocks.execFile.mockImplementationOnce((bin, args, options, callback) => {
    expect([bin, ...args.slice(0, 3)]).toEqual(['systemctl', '--user', 'show', OPENCLAW_GATEWAY_UNIT])
    expect(options.timeout).toBe(5_000)
    callback(error, Object.entries({ ...stopping, ...overrides }).map(([key, value]) => `${key}=${value}`).join('\n'), '')
  })
}

function journal(message: string, error: Error | null = null, from = since) {
  processMocks.execFile.mockImplementationOnce((bin, args, _options, callback) => {
    expect([bin, ...args.slice(0, 5)]).toEqual(['journalctl', '--user', '--boot', '-u', OPENCLAW_GATEWAY_UNIT, '--since'])
    expect(args[5]).toBe(`@${(from / 1000).toFixed(3)}`)
    expect(args).toContain('--quiet')
    expect(new RegExp(args[7]).test('[telegram] [default] channel stop exceeded 5000ms after abort')).toBe(true)
    expect(new RegExp(args[7]).test('[discord] channel stop exceeded 5000ms after abort')).toBe(false)
    callback(error, message, '')
  })
}

function monitor() {
  const onStop = vi.fn()
  stopMonitor = monitorGatewayStop(OPENCLAW_GATEWAY_UNIT, onStop)
  return onStop
}

describe('systemd gateway stopping monitor', () => {
  it.each([20_000, 30_000])('does not inspect the journal at %sms of deactivation', async elapsed => {
    vi.setSystemTime(since + elapsed)
    showUnit()
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(0)
    expect(onStop).toHaveBeenCalledWith(null)
    expect(processMocks.execFile).toHaveBeenCalledOnce()
  })

  it('uses the current stop journal and remaining timeout across stop substates, then clears the notice', async () => {
    showUnit({ InactiveExitTimestamp: '' })
    journal('[telegram] channel stop exceeded 5000ms after abort')
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(0)
    expect(onStop).toHaveBeenLastCalledWith({ since, telegram: true, remainingMinutes: 5 })

    vi.setSystemTime(since + 305_000)
    showUnit({ InactiveExitTimestamp: 'malformed', StateChangeTimestamp: 'Thu 2026-11-26 01:25:00.000000 UTC' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onStop).toHaveBeenLastCalledWith({ since, telegram: true, remainingMinutes: 1 })
    expect(processMocks.execFile).toHaveBeenCalledTimes(3)

    showUnit({ ActiveState: 'activating' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onStop).toHaveBeenLastCalledWith(null)
  })

  it.each([null, Object.assign(new Error('no journal match'), { code: 1, stderr: '' })])(
    'caches an empty journal search for the stop and inspects the next stop (%s)', async error => {
      showUnit()
      journal('', error)
      const onStop = monitor()
      await vi.advanceTimersByTimeAsync(0)
      expect(onStop).toHaveBeenLastCalledWith({ since, telegram: false, remainingMinutes: 5 })
      showUnit()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(processMocks.execFile).toHaveBeenCalledTimes(3)
      const nextSince = since + 10_000
      showUnit({ ActiveExitTimestamp: new Date(nextSince).toISOString() })
      journal('[telegram] channel stop exceeded 5000ms', null, nextSince)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onStop).toHaveBeenLastCalledWith(expect.objectContaining({ since: nextSince, telegram: true }))
    },
  )

  it.each(['infinity', overflow])('shows an unknown stop timeout without a countdown (%s)', async TimeoutStopUSec => {
    showUnit({ TimeoutStopUSec })
    journal('')
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(0)
    expect(onStop).toHaveBeenLastCalledWith({ since, telegram: false, remainingMinutes: undefined })
  })

  it('limits journal retries per stop and spaces them by 10 and 20 seconds', async () => {
    const error = Object.assign(new Error('Permission denied'), { code: 1, stderr: 'Permission denied' })
    showUnit()
    journal('', error)
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(0)
    for (let seconds = 5; seconds <= 60; seconds += 5) {
      showUnit()
      if (seconds === 10 || seconds === 30) journal('', error)
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(processMocks.execFile.mock.calls.filter(([bin]) => bin === 'journalctl')).toHaveLength(3)
    expect(onStop).toHaveBeenLastCalledWith(expect.objectContaining({ telegram: false }))
  })

  it('backs off for an absent unit or failed manager, resets after recovery, and clears the idle timer', async () => {
    showUnit({ LoadState: 'not-found' })
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      const calls = processMocks.execFile.mock.calls.length
      showUnit({}, new Error('Failed to connect to bus'))
      await vi.advanceTimersByTimeAsync(1)
      expect(processMocks.execFile).toHaveBeenCalledTimes(calls + 1)
    }

    showUnit({ ActiveState: 'active' })
    await vi.advanceTimersByTimeAsync(60_000)
    const calls = processMocks.execFile.mock.calls.length
    await vi.advanceTimersByTimeAsync(14_999)
    expect(processMocks.execFile).toHaveBeenCalledTimes(calls)
    showUnit({ LoadState: 'not-found' })
    await vi.advanceTimersByTimeAsync(1)
    showUnit({ ActiveState: 'active' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(processMocks.execFile).toHaveBeenCalledTimes(calls + 2)
    expect(onStop).toHaveBeenLastCalledWith(null)

    stopMonitor?.()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(processMocks.execFile).toHaveBeenCalledTimes(calls + 2)
  })

  it('does not overlap probes or rearm when an in-flight poll settles after cleanup', async () => {
    let complete: () => void = () => { throw new Error('No probe in flight') }
    processMocks.execFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      complete = () => callback(null, 'LoadState=loaded\nActiveState=active', '')
    })
    const onStop = monitor()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(processMocks.execFile).toHaveBeenCalledOnce()
    stopMonitor?.()
    complete()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onStop).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('gateway stop start timestamp', () => {
  it.each(['', 'malformed'])('keeps the current ActiveExitTimestamp when InactiveExitTimestamp is %j', value => {
    expect(stopStartedAt({ ...stopping, InactiveExitTimestamp: value })).toBe(since)
  })

  it.each(['', 'malformed'])('uses StateChangeTimestamp when ActiveExitTimestamp is %j', value => {
    expect(stopStartedAt({ ...stopping, ActiveExitTimestamp: value })).toBe(since + 10_000)
  })

  it('uses StateChangeTimestamp when the finite ActiveExitTimestamp belongs to the previous activation', () => {
    expect(stopStartedAt({ ...stopping, InactiveExitTimestamp: 'Thu 2026-11-26 01:23:05.000000 UTC' })).toBe(since + 10_000)
  })

  it('has no anchor when the exit and fallback timestamps are both unusable', () => {
    expect(stopStartedAt({ ...stopping, ActiveExitTimestamp: '', StateChangeTimestamp: 'malformed' })).toBeUndefined()
  })
})

describe('gateway command budgets', () => {
  it('allows enough time for the reported stop and start', () => {
    expect(gatewayActionTimeout('stop', 120_000, stopping)).toBe(335_000)
    expect(gatewayActionTimeout('restart', 15_000, { ...stopping, TimeoutStartUSec: '30s' })).toBe(370_000)
    expect(gatewayActionTimeout('restart', 120_000, stopping)).toBe(455_000)
    expect(gatewayActionTimeout('start', 60_000, stopping)).toBe(395_000)
    expect(gatewayActionTimeout('start', 60_000, { ...stopping, ActiveState: 'inactive' })).toBe(60_000)
  })

  it.each(['infinity', '0', '25d', overflow])('treats unbounded or over-limit values as unknown and caps commands (%s)', raw => {
    expect(parseSystemdDurationMs(raw)).toBeUndefined()
    for (const action of ['start', 'stop', 'restart'] as const) {
      expect(gatewayActionTimeout(action, 60_000, { ...stopping, TimeoutStopUSec: raw })).toBe(MAX_GATEWAY_WAIT_MS)
    }
    expect(gatewayActionTimeout('start', 60_000, { TimeoutStartUSec: raw })).toBe(MAX_GATEWAY_WAIT_MS)
  })

  it('retains the baseline for a missing timeout and caps the combined stop and start', () => {
    expect(gatewayActionTimeout('restart', 60_000, {})).toBe(60_000)
    expect(gatewayActionTimeout('restart', 180_000, { TimeoutStopUSec: '13min' })).toBe(MAX_GATEWAY_WAIT_MS)
    expect(parseSystemdDurationMs('1h 2min')).toBeUndefined()
    expect(parseSystemdDurationMs('2min 3s 4ms 500us')).toBe(123_004.5)
  })
})
