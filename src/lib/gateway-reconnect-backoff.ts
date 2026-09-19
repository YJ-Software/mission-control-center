/**
 * Delay before the next Gateway reconnect attempt.
 *
 * A flat 5s retry against a gateway that stays down wrote two log lines every
 * 5s (~35k/day) into a log that, until the logrotate timer existed, never
 * rotated. Doubling from 5s keeps a quick gateway restart as fast as before
 * while a long outage settles at one attempt a minute.
 *
 * @param failures consecutive failed attempts since the last successful auth
 */
export const RECONNECT_BASE_MS = 5_000
export const RECONNECT_MAX_MS = 60_000

export function reconnectDelayMs(failures: number): number {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0
  // 2^4 * 5s already exceeds the cap; clamping the exponent avoids Infinity.
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.min(n, 4), RECONNECT_MAX_MS)
}
