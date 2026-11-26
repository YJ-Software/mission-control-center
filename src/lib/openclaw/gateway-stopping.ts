import type { GatewayStopStatus } from '../gateway/link-status'
import { userUnitJournalMatches } from '../logs/journal'
import {
  gatewayStopProperties, parseSystemdDurationMs, showGatewayUnit, stopStartedAt,
} from './gateway-systemd'

const TELEGRAM_STOP = String.raw`\[telegram\][^\n]*channel stop exceeded \d+ms`
const STOP_POLL_MS = 5_000
const ACTIVE_POLL_MS = 15_000
const MAX_UNAVAILABLE_POLL_MS = 60_000
const JOURNAL_RETRY_MS = [10_000, 20_000]

export function monitorGatewayStop(unit: string, onStop: (status: GatewayStopStatus | null) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let unavailableDelay = STOP_POLL_MS
  let journal: { since: number; telegram?: boolean; attempts: number; retryAt: number } | undefined

  const poll = async () => {
    const state = await showGatewayUnit(unit, true, gatewayStopProperties)
    if (closed) return
    const available = state.LoadState === 'loaded'
    const delay = available ? (state.ActiveState === 'active' ? ACTIVE_POLL_MS : STOP_POLL_MS) : unavailableDelay
    unavailableDelay = available ? STOP_POLL_MS : Math.min(MAX_UNAVAILABLE_POLL_MS, unavailableDelay * 2)

    let status: GatewayStopStatus | null = null
    if (available) {
      if (state.ActiveState !== 'deactivating') journal = undefined
      const since = stopStartedAt(state)
      if (since !== undefined && Date.now() - since > 30_000) {
        if (journal?.since !== since) journal = { since, attempts: 0, retryAt: 0 }
        if (journal.telegram === undefined && performance.now() >= journal.retryAt) {
          journal.telegram = await userUnitJournalMatches(unit, since, TELEGRAM_STOP)
          if (closed) return
          journal.retryAt = performance.now() + (JOURNAL_RETRY_MS[journal.attempts++] ?? Infinity)
        }
        const timeout = parseSystemdDurationMs(state.TimeoutStopUSec)
        status = {
          since,
          telegram: journal.telegram ?? false,
          remainingMinutes: timeout === undefined ? undefined
            : Math.max(0, Math.ceil((timeout - (Date.now() - since)) / 60_000)),
        }
      }
    }

    timer = setTimeout(poll, delay)
    onStop(status)
  }
  void poll()
  return () => {
    closed = true
    clearTimeout(timer)
  }
}
