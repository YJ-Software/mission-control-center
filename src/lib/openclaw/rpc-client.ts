export async function rpcCall<T = unknown>(method: string, params?: unknown): Promise<T> {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: params ?? {} }),
  })
  const json = (await res.json().catch(() => ({}))) as { result?: T; error?: string }
  if (!res.ok) throw new Error(json.error || `RPC failed: ${res.status}`)
  return json.result as T
}
