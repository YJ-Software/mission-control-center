import { describe, it, expect } from 'vitest'
import { reconnectDelayMs } from '@/lib/gateway-reconnect-backoff'

describe('reconnectDelayMs', () => {
  it('starts at 5s so a brief gateway restart reconnects as fast as before', () => {
    expect(reconnectDelayMs(0)).toBe(5_000)
  })

  it('doubles per consecutive failure', () => {
    expect(reconnectDelayMs(1)).toBe(10_000)
    expect(reconnectDelayMs(2)).toBe(20_000)
    expect(reconnectDelayMs(3)).toBe(40_000)
  })

  it('caps at 60s — a gateway that is down all day logs ~1.4k lines, not ~35k', () => {
    expect(reconnectDelayMs(4)).toBe(60_000)
    expect(reconnectDelayMs(50)).toBe(60_000)
    expect(reconnectDelayMs(10_000)).toBe(60_000)
  })

  it('treats nonsense input as the first attempt', () => {
    expect(reconnectDelayMs(-1)).toBe(5_000)
    expect(reconnectDelayMs(Number.NaN)).toBe(5_000)
  })
})
