import { NextResponse } from 'next/server'
import { gatewayRequest } from '@/lib/gateway-rpc'
import { isAllowedAgentRpc } from '@/lib/openclaw/rpc-methods'

export async function POST(req: Request) {
  let body: { method?: string; params?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const method = body?.method
  if (typeof method !== 'string' || !method) {
    return NextResponse.json({ error: 'missing method' }, { status: 400 })
  }
  if (!isAllowedAgentRpc(method)) {
    return NextResponse.json({ error: `method not allowed: ${method}` }, { status: 403 })
  }
  try {
    const result = await gatewayRequest(method, body.params ?? {})
    return NextResponse.json({ result })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || String(err) }, { status: 502 })
  }
}
