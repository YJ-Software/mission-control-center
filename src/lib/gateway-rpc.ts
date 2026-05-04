export async function gatewayRequest(method: string, params?: unknown): Promise<unknown> {
  const rpc = (globalThis as any).__gatewayRpc
  if (typeof rpc !== 'function') {
    throw new Error('Gateway RPC not available (server.ts not initialized)')
  }
  return rpc(method, params)
}
