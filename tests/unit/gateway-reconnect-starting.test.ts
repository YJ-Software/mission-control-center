import { describe, it, expect, vi } from 'vitest'

// Safety valve: this suite is pure. If the module under test ever pulls in a
// real socket, a process spawn or anything else with side effects, fail the
// import instead of touching a live gateway / openclaw / systemctl.
vi.mock('ws', () => { throw new Error('test must not open a real WebSocket') })
vi.mock('child_process', () => { throw new Error('test must not spawn processes') })
vi.mock('node:child_process', () => { throw new Error('test must not spawn processes') })

import {
  GatewayReconnectBackoff,
  GATEWAY_STARTING_RETRY_MS,
  GATEWAY_STARTING_FAST_RETRIES,
  reconnectDelayMs,
} from '@/lib/gateway-reconnect-backoff'

function grown(failures: number): GatewayReconnectBackoff {
  const b = new GatewayReconnectBackoff()
  for (let i = 0; i < failures; i++) b.next('disconnect')
  return b
}

describe('GatewayReconnectBackoff', () => {
  it('uses a short fixed retry (2–3s) for "gateway starting"', () => {
    expect(GATEWAY_STARTING_RETRY_MS).toBeGreaterThanOrEqual(2_000)
    expect(GATEWAY_STARTING_RETRY_MS).toBeLessThanOrEqual(3_000)
    const b = new GatewayReconnectBackoff()
    for (let i = 0; i < 10; i++) expect(b.next('starting')).toBe(GATEWAY_STARTING_RETRY_MS)
  })

  it('regression: a backoff grown while the gateway was down does not delay a "starting" retry', () => {
    const b = grown(5) // 5,10,20,40,60 — the 0.4.3 report's 18–60s link delay
    expect(b.consecutiveFailures).toBe(5)
    expect(b.next('starting')).toBe(GATEWAY_STARTING_RETRY_MS)
  })

  it('"starting" bypasses the normal backoff without resetting it', () => {
    const b = grown(3)
    for (let i = 0; i < 5; i++) b.next('starting')
    expect(b.consecutiveFailures).toBe(3)
    expect(b.next('disconnect')).toBe(reconnectDelayMs(3)) // 40s, not back to 5s
  })

  it('"starting" closes do not accumulate into the normal backoff', () => {
    const b = new GatewayReconnectBackoff()
    for (let i = 0; i < 20; i++) b.next('starting')
    expect(b.consecutiveFailures).toBe(0)
    expect(b.next('disconnect')).toBe(reconnectDelayMs(0))
  })

  it('does not expose an open-time reset: only hello-ok resets the normal backoff', () => {
    // An accept-then-drop loop (open → 1011 → open → …) must keep growing to
    // 60s instead of retrying every 5s forever.
    const b = new GatewayReconnectBackoff()
    expect('onOpen' in b).toBe(false)
    expect([1, 2, 3, 4, 5].map(() => b.next('disconnect')))
      .toEqual([5_000, 10_000, 20_000, 40_000, 60_000])
    b.onLinked()
    expect(b.consecutiveFailures).toBe(0)
    expect(b.next('disconnect')).toBe(5_000)
  })

  it('1006 and other plain drops still use the normal 5s→60s backoff', () => {
    const b = new GatewayReconnectBackoff()
    expect([1, 2, 3, 4, 5, 6].map(() => b.next('disconnect')))
      .toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
  })

  it('a gateway stuck in "starting" falls back to the growing backoff after ~2 min', () => {
    const b = new GatewayReconnectBackoff()
    for (let i = 0; i < GATEWAY_STARTING_FAST_RETRIES; i++) {
      expect(b.next('starting')).toBe(GATEWAY_STARTING_RETRY_MS)
    }
    expect(GATEWAY_STARTING_FAST_RETRIES * GATEWAY_STARTING_RETRY_MS).toBeLessThanOrEqual(150_000)
    expect(b.next('starting')).toBe(5_000)
    expect(b.next('starting')).toBe(10_000)
    for (let i = 0; i < 10; i++) b.next('starting')
    expect(b.next('starting')).toBe(60_000)
  })

  it('hello-ok clears both the plain backoff and the starting streak', () => {
    const b = new GatewayReconnectBackoff()
    for (let i = 0; i < GATEWAY_STARTING_FAST_RETRIES + 3; i++) b.next('starting')
    b.next('disconnect')
    b.onLinked()
    expect(b.next('starting')).toBe(GATEWAY_STARTING_RETRY_MS)
    expect(b.next('disconnect')).toBe(5_000)
  })
})
