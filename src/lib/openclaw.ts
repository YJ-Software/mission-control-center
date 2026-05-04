/**
 * OpenClaw Gateway client
 * Connects to the local OpenClaw gateway via WebSocket
 */

export const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_WS || 'ws://127.0.0.1:18789'
export const GATEWAY_HTTP = process.env.OPENCLAW_GATEWAY_HTTP || 'http://127.0.0.1:18789'
export const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || ''

// REST proxy helpers (server-side only)
export async function gatewayFetch(path: string, options: RequestInit = {}) {
  const url = `${GATEWAY_HTTP}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gateway error ${res.status}: ${text}`)
  }
  return res.json()
}

// WebSocket message types based on OpenClaw protocol
export type GatewayMessage =
  | { type: 'connect'; token?: string; password?: string }
  | { type: 'hello-ok'; stateVersion: number; uptimeMs: number }
  | { type: 'req'; id: string; method: string; params?: unknown }
  | { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: string }
  | { type: 'event'; kind: string; data: unknown }

export function createAuthMessage() {
  return JSON.stringify({
    type: 'connect',
    token: GATEWAY_TOKEN,
  })
}
