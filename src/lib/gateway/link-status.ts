/**
 * MCC → Gateway link status, as pushed from server.ts to every browser tab.
 *
 * The sidebar used to show "Gateway Linked" whenever the BROWSER's socket to
 * MCC was open — it never looked at MCC's own socket to the Gateway. So after
 * a failed self-pairing the sidebar still said Linked while every chat timed
 * out. "linked" now means: MCC's Gateway socket is open AND the handshake
 * finished (`hello-ok`).
 *
 * Shared by server.ts (producer) and the websocket store / sidebar (consumer);
 * keep it free of Node- and React-specific imports.
 */

export type GatewayLinkState =
  /** Socket opening or open but the connect handshake has not finished. */
  | 'connecting'
  /** Socket open and handshake (`hello-ok`) completed. */
  | 'linked'
  /** Gateway asked for pairing; the self-approval CLI is running. */
  | 'pairing'
  /** Self-approval failed; a reconnect + new approval is scheduled. */
  | 'pairing-retry'
  /** Gateway rejected our credentials (token mismatch etc.); retrying slowly. */
  | 'auth-failed'
  /** Socket closed / Gateway unreachable; reconnecting with backoff. */
  | 'offline'

export interface GatewayLinkStatus {
  state: GatewayLinkState
  /** Epoch ms of the last state change. */
  since: number
  /** Which agent runtime this dashboard drives. Hermes mode has no Gateway. */
  runtime: 'openclaw' | 'hermes'
  /** Consecutive failed self-approvals (pairing / pairing-retry only). */
  pairingFailures?: number
  /** Epoch ms of the scheduled pairing retry (pairing-retry only). */
  nextRetryAt?: number | null
  /** Last close code / reason, for the tooltip. */
  lastClose?: { code: number; reason: string } | null
}

export const GATEWAY_STATUS_FRAME_TYPE = 'mcc:gateway-status'

const STATES: ReadonlySet<string> = new Set<GatewayLinkState>([
  'connecting', 'linked', 'pairing', 'pairing-retry', 'auth-failed', 'offline',
])

export function gatewayStatusFrame(status: GatewayLinkStatus): string {
  return JSON.stringify({ type: GATEWAY_STATUS_FRAME_TYPE, payload: status })
}

/** Returns the status if `msg` is a well-formed status frame, else null. */
export function parseGatewayStatusFrame(msg: unknown): GatewayLinkStatus | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as { type?: unknown; payload?: unknown }
  if (m.type !== GATEWAY_STATUS_FRAME_TYPE) return null
  const p = m.payload as Partial<GatewayLinkStatus> | undefined
  if (!p || typeof p.state !== 'string' || !STATES.has(p.state)) return null
  return {
    state: p.state as GatewayLinkState,
    since: typeof p.since === 'number' ? p.since : Date.now(),
    runtime: p.runtime === 'hermes' ? 'hermes' : 'openclaw',
    pairingFailures: typeof p.pairingFailures === 'number' ? p.pairingFailures : undefined,
    nextRetryAt: typeof p.nextRetryAt === 'number' ? p.nextRetryAt : null,
    lastClose: p.lastClose && typeof p.lastClose === 'object'
      && typeof p.lastClose.code === 'number' && typeof p.lastClose.reason === 'string'
      ? { code: p.lastClose.code, reason: p.lastClose.reason }
      : null,
  }
}

export type GatewayStatusTone = 'active' | 'pending' | 'error'

export interface GatewayStatusView {
  /** Maps to the `status-dot-<tone>` class. */
  tone: GatewayStatusTone
  /** Key under the `nav.gatewayStatus` i18n namespace. */
  labelKey:
    | 'linked' | 'connecting' | 'pairing' | 'pairingRetry'
    | 'authFailed' | 'offline' | 'dashboardOffline' | 'hermes'
  /** Interpolation values for the label. */
  values?: Record<string, number>
}

/**
 * What the sidebar shows. `browserConnected` is the tab's own socket to MCC:
 * without it we know nothing about the Gateway, so we say so instead of
 * guessing. `status` is null until the first status frame arrives.
 */
export function gatewayStatusView(
  status: GatewayLinkStatus | null,
  browserConnected: boolean,
): GatewayStatusView {
  if (!browserConnected) return { tone: 'error', labelKey: 'dashboardOffline' }
  if (!status) return { tone: 'pending', labelKey: 'connecting' }
  if (status.runtime === 'hermes') return { tone: 'active', labelKey: 'hermes' }
  switch (status.state) {
    case 'linked': return { tone: 'active', labelKey: 'linked' }
    case 'connecting': return { tone: 'pending', labelKey: 'connecting' }
    case 'pairing': return { tone: 'pending', labelKey: 'pairing' }
    case 'pairing-retry':
      return { tone: 'error', labelKey: 'pairingRetry', values: { n: Math.max(1, status.pairingFailures ?? 1) } }
    case 'auth-failed': return { tone: 'error', labelKey: 'authFailed' }
    case 'offline': return { tone: 'error', labelKey: 'offline' }
  }
}

/**
 * Whether Gateway-backed data (chat.history, pending interactions, …) can be
 * fetched right now: this tab reached MCC AND MCC's Gateway handshake is done.
 * Hermes mode has no Gateway — the chat bridge answers as soon as the tab is
 * connected. Hooks re-fetch when this flips to true.
 */
export function isGatewayReady(status: GatewayLinkStatus | null, browserConnected: boolean): boolean {
  if (!browserConnected || !status) return false
  return status.runtime === 'hermes' || status.state === 'linked'
}
