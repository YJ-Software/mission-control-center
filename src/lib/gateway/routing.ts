/**
 * Pure routing decisions for server.ts's Gateway link (no I/O, unit-tested).
 */
import type { GatewayLinkState } from './link-status'

export type BrowserFrameRoute =
  | { kind: 'forward' }
  | { kind: 'reply'; frame: string }
  | { kind: 'drop' }

/**
 * What to do with a frame a browser tab sent for the Gateway.
 *
 * Forward ONLY when MCC's Gateway socket is open AND the handshake finished
 * (`linked`). OpenClaw answers any non-`connect` request that arrives before
 * hello-ok — including in the gap after our `connect` was sent — with
 * "invalid handshake: first request must be connect" and closes the socket
 * with 1008. Forwarding during `connecting` therefore killed MCC's own link.
 *
 * Otherwise a request is answered at once with the reason, instead of being
 * dropped and left to the browser's 30s `RPC timeout`. Non-request frames
 * (e.g. the browser's `client-connect` hello) are dropped.
 */
export function routeBrowserFrameToGateway(
  raw: string,
  link: { socketOpen: boolean; state: GatewayLinkState },
): BrowserFrameRoute {
  if (link.socketOpen && link.state === 'linked') return { kind: 'forward' }
  let frame: { type?: unknown; id?: unknown } | null = null
  try {
    frame = JSON.parse(raw) as { type?: unknown; id?: unknown }
  } catch {
    return { kind: 'drop' }
  }
  if (frame?.type === 'req' && (typeof frame.id === 'string' || typeof frame.id === 'number')) {
    return {
      kind: 'reply',
      frame: JSON.stringify({
        type: 'res',
        id: frame.id,
        ok: false,
        error: { message: `Gateway not connected (${link.state})` },
      }),
    }
  }
  return { kind: 'drop' }
}

export type GatewayCloseKind =
  /** `1008 pairing required: …` — self-approve via PairingRetry. */
  | 'pairing'
  /** Credentials rejected (token mismatch etc.) — slow 30s retry. */
  | 'auth'
  /** Anything else — normal reconnect backoff. */
  | 'disconnect'

export function classifyGatewayClose(code: number, reason: string): GatewayCloseKind {
  if (code === 1008 && reason.includes('pairing required')) return 'pairing'
  // A protocol slip on our side ("invalid handshake: first request must be
  // connect") is not a credential problem: reconnect normally instead of
  // showing "auth failed" and waiting 30s.
  if (reason.includes('invalid handshake')) return 'disconnect'
  if (code === 1008 || reason.includes('identity required') || reason.includes('unauthorized')) return 'auth'
  return 'disconnect'
}
