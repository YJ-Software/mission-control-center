export function gatewayRpcTimeoutMs(method: string): number {
  // Logout waits for OpenClaw to update the credential store and reload config.
  return method === 'models.authLogout' ? 30_000 : 10_000
}

export async function gatewayRequest(method: string, params?: unknown): Promise<unknown> {
  const rpc = (globalThis as any).__gatewayRpc
  if (typeof rpc !== 'function') {
    throw new Error('Gateway RPC not available (server.ts not initialized)')
  }
  return rpc(method, params)
}
