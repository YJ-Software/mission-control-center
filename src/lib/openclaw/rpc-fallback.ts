import { gatewayRequest } from '@/lib/gateway-rpc'

/** 只有連線／舊版方法不可用才退回 CLI；權限與業務錯誤不能用 CLI 繞過。 */
export function isGatewayRpcUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /gateway.*(?:not available|unavailable|not connected|not linked|not initiali[sz]ed|disconnected|closed)|RPC timeout|unknown method|method (?:not found|not supported)|unsupported method/i.test(message)
}

export async function gatewayReadWithFallback<T>(
  method: string,
  params: unknown,
  map: (response: unknown) => T,
  cli: () => Promise<T>,
): Promise<T> {
  let response: unknown
  try {
    response = await gatewayRequest(method, params)
  } catch (err) {
    if (!isGatewayRpcUnavailable(err)) throw err
    return cli()
  }
  return map(response)
}

/** config.get 回傳 snapshot；只取與 config get CLI 同樣遮罩的 config，不能用 raw/parsed。 */
export function rpcConfig(response: unknown): Record<string, any> {
  const snapshot = response as { valid?: boolean; config?: unknown } | null
  if (snapshot?.valid === false) throw new Error('config get failed: invalid OpenClaw config')
  if (!snapshot?.config || typeof snapshot.config !== 'object' || Array.isArray(snapshot.config)) {
    throw new Error('config get failed: invalid gateway response')
  }
  return snapshot.config as Record<string, any>
}

/** RPC 也列出可安裝的官方外掛；CLI plugins list 只列本機已發現的外掛。 */
export function rpcInstalledPlugins(response: unknown): { id: string; name?: string }[] {
  const result = response as { plugins?: { id: string; name?: string; installed: boolean }[] } | null
  if (!Array.isArray(result?.plugins) || result.plugins.some((p) => !p || typeof p.id !== 'string' || typeof p.installed !== 'boolean')) {
    throw new Error('plugins list failed: invalid gateway response')
  }
  return result.plugins.filter((p) => p.installed)
}
