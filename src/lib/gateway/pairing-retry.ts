/**
 * Gateway self-pairing retry state machine.
 *
 * When the Gateway closes our socket with `1008 pairing required`, server.ts
 * spawns the `openclaw` CLI to approve our own device. That approval can fail
 * for transient reasons — most often the Gateway is mid-restart (an OCD
 * redeploy wipes pairing records and restarts the Gateway right after MCC
 * comes up), so the CLI answers "Couldn't connect to OpenClaw".
 *
 * The previous one-shot `pairingAttempted` flag gave up after that single
 * failure and never reconnected again: every chat then timed out until a
 * dashboard restart. This machine instead:
 *
 *   - runs at most ONE approval (one CLI chain) at a time;
 *   - on failure, schedules a reconnect with backoff 2s → 4s → 8s → 16s → 30s
 *     (capped, no attempt limit, one log line per failure). The reconnect is
 *     what retries: it yields a fresh `pairing required` (and a fresh pending
 *     request if the Gateway restarted and lost the old one), which starts the
 *     next approval;
 *   - on CLI success, reconnects after a short pause — but does NOT reset the
 *     failure count: only a completed handshake (`hello-ok`) proves the
 *     approval took. If the reconnect is met by `pairing required` again
 *     (role/scope upgrade, a superseded request, …), that counts as a failure
 *     and backs off, instead of looping approve → 1s → 1008 every second;
 *   - resets on a successful handshake, so a later 1008 — e.g. the next
 *     redeploy — pairs again from the first backoff step.
 *
 * No I/O here: approval, reconnect, timers and logging are injected, so the
 * whole thing is unit-testable without spawning anything.
 */

export const PAIRING_RETRY_BASE_MS = 2_000
export const PAIRING_RETRY_MAX_MS = 30_000
/** Pause between a successful approval and the reconnect that uses it. */
export const PAIRING_RECONNECT_AFTER_APPROVAL_MS = 1_000
/**
 * Upper bound on one approval attempt. Each CLI call has its own 10s timeout
 * and tryAutoApproveDevice() makes at most six of them, so this only trips if
 * something hangs outside those timeouts. On trip the attempt is aborted
 * (killing its child process) before the lock is released, so two CLI chains
 * never overlap.
 */
export const PAIRING_ATTEMPT_TIMEOUT_MS = 90_000

/** Delay before retry n (0-based count of consecutive failed approvals). */
export function pairingRetryDelayMs(failures: number): number {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0
  // 2^4 * 2s already exceeds the cap; clamping the exponent avoids Infinity.
  return Math.min(PAIRING_RETRY_BASE_MS * 2 ** Math.min(n, 5), PAIRING_RETRY_MAX_MS)
}

export type PairingPhase = 'idle' | 'approving' | 'waiting-retry'

export interface PairingSnapshot {
  phase: PairingPhase
  /** Consecutive failed approvals since the last completed handshake. */
  failures: number
  /** Outcome of the latest attempt; 'approved' while reconnecting after a CLI success. */
  lastOutcome: 'approved' | 'failed' | null
  /** Epoch ms of the scheduled retry while phase is 'waiting-retry'. */
  nextRetryAt: number | null
}

export interface PairingRetryDeps {
  /**
   * Find and approve our pending pairing request. Resolves true on success,
   * false on a handled failure; may also reject. Must honour `signal`
   * (pass it to execFile) so an abort actually stops the child process.
   */
  approve: (signal: AbortSignal) => Promise<boolean>
  /** Open a new Gateway connection. */
  reconnect: () => void
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
  now?: () => number
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  /** Called after every phase change (drives the dashboard status). */
  onChange?: (snapshot: PairingSnapshot) => void
  attemptTimeoutMs?: number
}

export type PairingRequiredResult =
  /** A new approval was started. */
  | 'started'
  /** An approval is already running; its outcome schedules the reconnect. */
  | 'in-flight'
  /** A retry is already scheduled; it will reconnect. */
  | 'scheduled'
  /**
   * The previous CLI approval "succeeded" but the Gateway still wants
   * pairing: counted as a failure, reconnect scheduled with backoff.
   */
  | 'approval-not-effective'

export class PairingRetry {
  private phase: PairingPhase = 'idle'
  private failures = 0
  private lastOutcome: PairingSnapshot['lastOutcome'] = null
  /** Set after a CLI success until the next handshake or `pairing required`. */
  private awaitingHandshake = false
  private nextRetryAt: number | null = null
  private timer: unknown = null
  private attemptTimer: unknown = null
  private controller: AbortController | null = null
  /** Bumped whenever an in-flight attempt is abandoned; stale results are dropped. */
  private generation = 0

  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void
  private readonly now: () => number
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void
  private readonly attemptTimeoutMs: number

  constructor(private readonly deps: PairingRetryDeps) {
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.now = deps.now ?? (() => Date.now())
    this.log = deps.log ?? (() => {})
    this.attemptTimeoutMs = deps.attemptTimeoutMs ?? PAIRING_ATTEMPT_TIMEOUT_MS
  }

  snapshot(): PairingSnapshot {
    return {
      phase: this.phase,
      failures: this.failures,
      lastOutcome: this.lastOutcome,
      nextRetryAt: this.nextRetryAt,
    }
  }

  /** The Gateway closed our socket with `1008 pairing required`. */
  onPairingRequired(): PairingRequiredResult {
    if (this.phase === 'approving') return 'in-flight'
    if (this.phase === 'waiting-retry') return 'scheduled'
    if (this.awaitingHandshake) {
      this.awaitingHandshake = false
      this.fail('CLI approved our device but the Gateway still requires pairing')
      return 'approval-not-effective'
    }
    this.startAttempt()
    return 'started'
  }

  /**
   * The handshake completed (`hello-ok`). Whatever we were doing is moot:
   * drop any in-flight approval or pending retry and forget past failures.
   */
  onAuthenticated(): void {
    this.abandonAttempt()
    this.clearRetryTimer()
    this.failures = 0
    this.lastOutcome = null
    this.awaitingHandshake = false
    this.setPhase('idle')
  }

  /** Stop everything (process shutdown). */
  dispose(): void {
    this.abandonAttempt()
    this.clearRetryTimer()
    this.awaitingHandshake = false
    this.setPhase('idle')
  }

  private startAttempt(): void {
    const gen = ++this.generation
    const controller = new AbortController()
    this.controller = controller
    this.setPhase('approving')
    this.log('info', `[Gateway] Pairing required — attempting auto-approval (attempt ${this.failures + 1})...`)

    this.attemptTimer = this.schedule(() => {
      if (gen !== this.generation) return
      controller.abort()
      this.finishAttempt(gen, false, `timed out after ${Math.round(this.attemptTimeoutMs / 1000)}s`)
    }, this.attemptTimeoutMs)

    let result: Promise<boolean>
    try {
      result = Promise.resolve(this.deps.approve(controller.signal))
    } catch (err) {
      result = Promise.reject(err)
    }
    result.then(
      (approved) => this.finishAttempt(gen, approved, approved ? null : 'approval failed'),
      (err: unknown) => this.finishAttempt(gen, false, err instanceof Error ? err.message : String(err)),
    )
  }

  private finishAttempt(gen: number, approved: boolean, reason: string | null): void {
    if (gen !== this.generation || this.phase !== 'approving') return
    this.generation++
    this.controller = null
    if (this.attemptTimer !== null) {
      this.cancel(this.attemptTimer)
      this.attemptTimer = null
    }

    if (approved) {
      // Failures are NOT reset here — only hello-ok proves the approval took.
      this.lastOutcome = 'approved'
      this.awaitingHandshake = true
      this.log('info', `[Gateway] Device approved, reconnecting in ${PAIRING_RECONNECT_AFTER_APPROVAL_MS / 1000}s...`)
      this.scheduleReconnect(PAIRING_RECONNECT_AFTER_APPROVAL_MS)
      return
    }

    this.fail(reason ?? 'unknown')
  }

  private fail(reason: string): void {
    const delay = pairingRetryDelayMs(this.failures)
    this.failures++
    this.lastOutcome = 'failed'
    this.log(
      'warn',
      `[Gateway] Auto-approval failed (${reason}); retry #${this.failures} in ${delay / 1000}s. `
        + 'Manual fallback: openclaw devices approve --latest',
    )
    this.scheduleReconnect(delay)
  }

  private scheduleReconnect(delay: number): void {
    this.clearRetryTimer()
    this.nextRetryAt = this.now() + delay
    this.timer = this.schedule(() => {
      this.timer = null
      this.nextRetryAt = null
      this.setPhase('idle')
      this.deps.reconnect()
    }, delay)
    this.setPhase('waiting-retry')
  }

  private abandonAttempt(): void {
    if (this.phase !== 'approving') return
    this.generation++
    this.controller?.abort()
    this.controller = null
    if (this.attemptTimer !== null) {
      this.cancel(this.attemptTimer)
      this.attemptTimer = null
    }
  }

  private clearRetryTimer(): void {
    if (this.timer !== null) {
      this.cancel(this.timer)
      this.timer = null
    }
    this.nextRetryAt = null
  }

  private setPhase(phase: PairingPhase): void {
    if (phase === this.phase) return
    this.phase = phase
    this.deps.onChange?.(this.snapshot())
  }
}
