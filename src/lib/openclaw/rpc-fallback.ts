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

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 已查證 2026.10.8–11.2 的 config.patch 對這些路徑只熱套用不重啟；10.10 起 CLI 本身也轉送 config.patch，
 *  所以之後的版本沿用 RPC（含 -N build 後綴）。版本未知或更舊維持 CLI，避免中斷聊天與 MCC 的連線。 */
function gatewaySupportsConfigPatch(version: string | undefined): boolean {
  const m = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:-\d+)?$/)
  if (!m) return false
  const [y, mo, d] = m.slice(1).map(Number)
  return y > 2026 || (y === 2026 && (mo > 10 || (mo === 10 && d >= 8)))
}

function canPatchConfigPath(path: readonly string[]): boolean {
  const version = (globalThis as typeof globalThis & { __gatewayVersion?: string }).__gatewayVersion
  if (!gatewaySupportsConfigPatch(version)) return false
  if (path.some((key) => !key || ['__proto__', 'constructor', 'prototype'].includes(key))) return false
  return (path[0] === 'agents' && path[1] === 'entries' && path.length === 4 && path[3] === 'model')
    || (path[0] === 'models' && path[1] === 'providers' && path.length === 3)
    || (path[0] === 'mcp' && path[1] === 'servers' && path.length === 3)
}

/** config set 是替換子樹，merge-patch 則遞迴合併；補上刪除欄位與陣列替換意圖。 */
function replacementPatch(current: unknown, value: unknown, path: string, arrays: Set<string>): unknown {
  if (!isRecord(value)) {
    const collectArrays = (node: unknown, at: string) => {
      if (Array.isArray(node)) arrays.add(at)
      else if (isRecord(node)) for (const [key, child] of Object.entries(node)) collectArrays(child, `${at}.${key}`)
    }
    collectArrays(current, path)
    if (Array.isArray(value)) arrays.add(path)
    return value
  }
  if (Array.isArray(current)) arrays.add(path)
  const base = isRecord(current) ? current : {}
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(value)])].map((key) => [
    key, replacementPatch(base[key], Object.hasOwn(value, key) ? value[key] : null, `${path}.${key}`, arrays),
  ]))
}

/** null 表示 unset；物件內 null、遮罩值、環境參照及特殊 key 保留 CLI 的寫入語意。 */
function needsCliValue(value: unknown): boolean {
  if (value === null || value === '__OPENCLAW_REDACTED__') return true
  if (typeof value === 'string' && value.includes('${')) return true
  if (Array.isArray(value)) return value.some(needsCliValue)
  return isRecord(value) && Object.entries(value).some(([key, child]) =>
    ['__proto__', 'constructor', 'prototype'].includes(key) || needsCliValue(child))
}

/** 最小路徑 patch，不把 config.get 的遮罩快照送回去。cli 必須沿用原本的 CLI limiter。 */
export async function gatewayConfigPatchWithFallback<T>(
  path: string | readonly string[],
  value: unknown,
  cli: () => Promise<T>,
  success: T,
  failure: (err: unknown) => T = (err) => { throw err },
): Promise<T> {
  const keys = typeof path === 'string' ? path.split('.') : path
  if (!canPatchConfigPath(keys)) return cli()
  // 與原 CLI 的 JSON.stringify argv 一致：undefined 欄位應先省略，再計算刪除意圖。
  const json = JSON.stringify(value)
  if (json === undefined) return cli()
  const target: unknown = JSON.parse(json)
  if (value !== null && needsCliValue(target)) return cli()
  for (let attempt = 0; attempt < 2; attempt++) {
    let useCli = false
    try {
      const snapshot = await gatewayRequest('config.get', {}) as { hash?: string }
      const config = rpcConfig(snapshot)
      // reload=off 時 RPC 會主動 SIGUSR2，CLI 只提示稍後重啟，不能改變這個行為。
      if (config.gateway?.reload?.mode === 'off') useCli = true
      else {
        if (!snapshot.hash || typeof snapshot.hash !== 'string') throw new Error('config get failed: missing gateway hash')
        let current: unknown = config
        for (const key of keys) current = isRecord(current) && Object.hasOwn(current, key) ? current[key] : undefined
        const arrays = new Set<string>()
        let patch = replacementPatch(current, target, keys.join('.'), arrays)
        for (const key of [...keys].reverse()) patch = { [key]: patch }
        if (arrays.size > 256) useCli = true
        else {
          const response = await gatewayRequest('config.patch', {
            raw: JSON.stringify(patch), baseHash: snapshot.hash,
            ...(arrays.size ? { replacePaths: [...arrays] } : {}),
          }) as { ok?: boolean } | null
          if (response?.ok !== true) throw new Error('config patch failed: invalid gateway response')
          return success
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt === 0 && /config changed since last load|config write conflict/i.test(message)) continue
      // 已落盤的錯誤不能重寫；限流發生於 dispatch 前，可安全沿用原 CLI。
      if (!/persisted|recovery restart|accepted for restart/i.test(message)
        && (isGatewayRpcUnavailable(err) || /^rate limit exceeded for config\.patch; retry after \d+s$/i.test(message))) useCli = true
      else return failure(err)
    }
    if (useCli) return cli()
  }
  throw new Error('config patch retry exhausted')
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
