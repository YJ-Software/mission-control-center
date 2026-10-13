import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Safety valve: nothing in these tests may spawn a process (no real
// `openclaw`, no systemctl). The state machine takes `approve` by injection;
// if anything ever reaches child_process, fail loudly instead of running it.
vi.mock('child_process', () => {
  const boom = () => { throw new Error('child_process must not be used in pairing-retry tests') }
  return { spawn: boom, execFile: boom, exec: boom, execSync: boom, execFileSync: boom, fork: boom, default: {} }
})
vi.mock('node:child_process', () => {
  const boom = () => { throw new Error('node:child_process must not be used in pairing-retry tests') }
  return { spawn: boom, execFile: boom, exec: boom, execSync: boom, execFileSync: boom, fork: boom, default: {} }
})

import {
  PairingRetry,
  pairingRetryDelayMs,
  PAIRING_RECONNECT_AFTER_APPROVAL_MS,
  type PairingSnapshot,
} from '@/lib/gateway/pairing-retry'

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(opts: { attemptTimeoutMs?: number } = {}) {
  const attempts: Array<{ signal: AbortSignal; d: Deferred<boolean> }> = []
  const approve = vi.fn((signal: AbortSignal) => {
    const d = deferred<boolean>()
    attempts.push({ signal, d })
    return d.promise
  })
  const reconnect = vi.fn()
  const logs: Array<[string, string]> = []
  const changes: PairingSnapshot[] = []
  const machine = new PairingRetry({
    approve,
    reconnect,
    log: (level, msg) => logs.push([level, msg]),
    onChange: (s) => changes.push(s),
    attemptTimeoutMs: opts.attemptTimeoutMs,
  })
  return { machine, approve, reconnect, attempts, logs, changes }
}

/** Let promise callbacks settle without moving the clock. */
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pairingRetryDelayMs', () => {
  it('backs off 2s → 4s → 8s → 16s → 30s and stays capped', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 100].map(pairingRetryDelayMs))
      .toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000])
  })

  it('treats nonsense input as the first retry', () => {
    expect(pairingRetryDelayMs(-3)).toBe(2_000)
    expect(pairingRetryDelayMs(Number.NaN)).toBe(2_000)
    expect(pairingRetryDelayMs(Number.POSITIVE_INFINITY)).toBe(2_000)
  })
})

describe('PairingRetry', () => {
  it('retries forever with backoff: each failure schedules a reconnect, each 1008 starts the next attempt', async () => {
    const { machine, approve, reconnect, attempts, logs } = setup()
    const expected = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]

    for (let i = 0; i < expected.length; i++) {
      expect(machine.onPairingRequired()).toBe('started')
      expect(approve).toHaveBeenCalledTimes(i + 1)
      attempts[i].d.resolve(false)
      await flush()
      expect(machine.snapshot().phase).toBe('waiting-retry')
      expect(machine.snapshot().failures).toBe(i + 1)

      // Not a moment early…
      await vi.advanceTimersByTimeAsync(expected[i] - 1)
      expect(reconnect).toHaveBeenCalledTimes(i)
      // …and exactly once when due.
      await vi.advanceTimersByTimeAsync(1)
      expect(reconnect).toHaveBeenCalledTimes(i + 1)
      expect(machine.snapshot().phase).toBe('idle')
    }

    const failureLogs = logs.filter(([level]) => level === 'warn')
    expect(failureLogs).toHaveLength(expected.length)
    expect(failureLogs[0][1]).toMatch(/retry #1 in 2s/)
    expect(failureLogs[6][1]).toMatch(/retry #7 in 30s/)
  })

  it('counts a rejected approval (gateway mid-restart) as a failure and logs the reason', async () => {
    const { machine, reconnect, attempts, logs } = setup()
    machine.onPairingRequired()
    attempts[0].d.reject(new Error("Couldn't connect to OpenClaw"))
    await flush()
    expect(machine.snapshot()).toMatchObject({ phase: 'waiting-retry', failures: 1 })
    expect(logs.some(([l, m]) => l === 'warn' && m.includes("Couldn't connect to OpenClaw"))).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('counts a synchronous throw from approve as a failure', async () => {
    const reconnect = vi.fn()
    const machine = new PairingRetry({
      approve: () => { throw new Error('spawn ENOENT') },
      reconnect,
    })
    expect(machine.onPairingRequired()).toBe('started')
    await flush()
    expect(machine.snapshot()).toMatchObject({ phase: 'waiting-retry', failures: 1 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('runs only one approval at a time; extra 1008s while busy start nothing', async () => {
    const { machine, approve, reconnect, attempts } = setup()
    expect(machine.onPairingRequired()).toBe('started')
    expect(machine.onPairingRequired()).toBe('in-flight')
    expect(machine.onPairingRequired()).toBe('in-flight')
    expect(approve).toHaveBeenCalledTimes(1)

    attempts[0].d.resolve(false)
    await flush()
    // A retry is already scheduled — a stray 1008 must not start a second chain.
    expect(machine.onPairingRequired()).toBe('scheduled')
    expect(approve).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('on success resets failures and reconnects after 1s', async () => {
    const { machine, reconnect, attempts } = setup()
    machine.onPairingRequired()
    attempts[0].d.resolve(false)
    await flush()
    await vi.advanceTimersByTimeAsync(2_000)
    machine.onPairingRequired()
    attempts[1].d.resolve(false)
    await flush()
    expect(machine.snapshot().failures).toBe(2)
    await vi.advanceTimersByTimeAsync(4_000)

    machine.onPairingRequired()
    attempts[2].d.resolve(true)
    await flush()
    expect(machine.snapshot()).toMatchObject({ phase: 'waiting-retry', failures: 0 })
    const before = reconnect.mock.calls.length
    await vi.advanceTimersByTimeAsync(PAIRING_RECONNECT_AFTER_APPROVAL_MS)
    expect(reconnect).toHaveBeenCalledTimes(before + 1)
    expect(machine.snapshot().phase).toBe('idle')
  })

  it('after a successful handshake, a later 1008 pairs again from the first backoff step', async () => {
    const { machine, approve, attempts, reconnect } = setup()
    // Fail three times to build up backoff.
    for (let i = 0; i < 3; i++) {
      machine.onPairingRequired()
      attempts[i].d.resolve(false)
      await flush()
      await vi.advanceTimersByTimeAsync(pairingRetryDelayMs(i))
    }
    expect(machine.snapshot().failures).toBe(3)

    machine.onAuthenticated()
    expect(machine.snapshot()).toEqual({ phase: 'idle', failures: 0, nextRetryAt: null })

    // Next redeploy wipes pairing again: no permanent "already attempted" flag.
    expect(machine.onPairingRequired()).toBe('started')
    expect(approve).toHaveBeenCalledTimes(4)
    attempts[3].d.resolve(false)
    await flush()
    const before = reconnect.mock.calls.length
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnect).toHaveBeenCalledTimes(before + 1)
  })

  it('handshake during an approval aborts it and ignores its late result', async () => {
    const { machine, attempts, reconnect } = setup()
    machine.onPairingRequired()
    expect(attempts[0].signal.aborted).toBe(false)

    machine.onAuthenticated() // e.g. someone approved by hand
    expect(attempts[0].signal.aborted).toBe(true)
    expect(machine.snapshot().phase).toBe('idle')

    attempts[0].d.resolve(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(reconnect).not.toHaveBeenCalled()
    expect(machine.snapshot()).toEqual({ phase: 'idle', failures: 0, nextRetryAt: null })
  })

  it('handshake while a retry is pending cancels the retry', async () => {
    const { machine, attempts, reconnect } = setup()
    machine.onPairingRequired()
    attempts[0].d.resolve(false)
    await flush()
    machine.onAuthenticated()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('a hung approval is aborted after the attempt timeout, then retried; its late success is ignored', async () => {
    const { machine, attempts, reconnect, approve } = setup({ attemptTimeoutMs: 5_000 })
    machine.onPairingRequired()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(machine.snapshot().phase).toBe('approving')
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts[0].signal.aborted).toBe(true)
    expect(machine.snapshot()).toMatchObject({ phase: 'waiting-retry', failures: 1 })

    attempts[0].d.resolve(true) // too late — must not reset or double-schedule
    await flush()
    expect(machine.snapshot()).toMatchObject({ phase: 'waiting-retry', failures: 1 })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(machine.onPairingRequired()).toBe('started')
    expect(approve).toHaveBeenCalledTimes(2)
  })

  it('reports each phase change with failures and next retry time', async () => {
    const { machine, attempts, changes } = setup()
    machine.onPairingRequired()
    attempts[0].d.resolve(false)
    await flush()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(changes.map((c) => c.phase)).toEqual(['approving', 'waiting-retry', 'idle'])
    expect(changes[1].failures).toBe(1)
    expect(changes[1].nextRetryAt).toBe(Date.now())
    expect(changes[2].nextRetryAt).toBeNull()
  })

  it('dispose stops pending work', async () => {
    const { machine, attempts, reconnect } = setup()
    machine.onPairingRequired()
    machine.dispose()
    expect(attempts[0].signal.aborted).toBe(true)
    attempts[0].d.resolve(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(reconnect).not.toHaveBeenCalled()
  })
})

describe('server.ts wiring', () => {
  const src = readFileSync(join(__dirname, '../../server.ts'), 'utf8')

  it('has no one-shot pairing flag any more', () => {
    expect(src).not.toMatch(/pairingAttempted/)
  })

  it('routes pairing-required closes through PairingRetry without scheduling its own reconnect', () => {
    const branch = src.match(/if \(code === 1008 && reasonStr\.includes\('pairing required'\)\) \{([\s\S]*?)\n {6}\}/)
    expect(branch).not.toBeNull()
    expect(branch![1]).toContain('pairing.onPairingRequired()')
    expect(branch![1]).not.toMatch(/setTimeout|connectGateway/)
  })

  it('resets pairing and marks the link linked on hello-ok', () => {
    const helloOk = src.slice(src.indexOf("msg.payload?.type === 'hello-ok'"))
    const block = helloOk.slice(0, helloOk.indexOf('}'))
    expect(block).toContain('pairing.onAuthenticated()')
    expect(block).toContain("setGatewayLink('linked')")
  })
})
