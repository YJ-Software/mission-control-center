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

/**
 * Fixed short retry while the Gateway says it is still starting
 * (`1013 gateway starting`). The gateway process is up and accepting sockets;
 * it only needs a few seconds more, so reusing a backoff that grew to 20–60s
 * while it was down made MCC link 18–60s after the gateway was ready.
 */
export const GATEWAY_STARTING_RETRY_MS = 2_500
/**
 * How many consecutive "starting" closes get the short retry (~2 min). A
 * gateway stuck in "starting" past that falls back to the normal 5s→60s
 * schedule, so it cannot log two lines every 2.5s all day.
 */
export const GATEWAY_STARTING_FAST_RETRIES = 48

export type GatewayReconnectReason = 'starting' | 'disconnect'

/**
 * Reconnect delay state for server.ts's Gateway link (pure, unit-tested).
 * Pairing has its own backoff in PairingRetry and auth failures a flat 30s;
 * neither goes through here.
 */
export class GatewayReconnectBackoff {
  private failures = 0
  private startingStreak = 0

  /** Consecutive plain disconnects counted toward the normal backoff. */
  get consecutiveFailures(): number {
    return this.failures
  }

  /** WS `open`: the gateway is reachable, so drop the accumulated backoff. */
  onOpen(): void {
    this.failures = 0
  }

  /** `hello-ok`: fully linked. */
  onLinked(): void {
    this.failures = 0
    this.startingStreak = 0
  }

  /** Delay before the next attempt after a close of the given kind. */
  next(reason: GatewayReconnectReason): number {
    if (reason === 'starting') {
      // Reachable-but-starting is not a failure: never feed the normal backoff.
      this.failures = 0
      this.startingStreak++
      if (this.startingStreak <= GATEWAY_STARTING_FAST_RETRIES) return GATEWAY_STARTING_RETRY_MS
      return reconnectDelayMs(this.startingStreak - GATEWAY_STARTING_FAST_RETRIES - 1)
    }
    return reconnectDelayMs(this.failures++)
  }
}
