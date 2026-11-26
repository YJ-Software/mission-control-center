import type { GatewayStopStatus } from '../gateway/link-status'
import { userUnitJournalMatches } from '../logs/journal'
import {
  gatewayStopProperties, parseSystemdDurationMs, showGatewayUnit, stopStartedAt,
} from './gateway-systemd'

const TELEGRAM_STOP = String.raw`\[telegram\][^\n]*channel stop exceeded \d+ms`
export const GATEWAY_STOP_POLL_MS = 5_000

export async function readGatewayStop(
  unit: string, previous: GatewayStopStatus | null = null, now = Date.now,
): Promise<GatewayStopStatus | null> {
  const state = await showGatewayUnit(unit, true, gatewayStopProperties)
  if (state.LoadState !== 'loaded') return null
  const since = stopStartedAt(state)
  if (since === undefined || now() - since <= 30_000) return null
  const timeout = parseSystemdDurationMs(state.TimeoutStopUSec)
  const telegram = (previous?.since === since && previous.telegram)
    || await userUnitJournalMatches(unit, since, TELEGRAM_STOP)
  return {
    since,
    telegram,
    remainingMinutes: timeout !== undefined && Number.isFinite(timeout)
      ? Math.max(0, Math.ceil((timeout - (now() - since)) / 60_000))
      : undefined,
  }
}
