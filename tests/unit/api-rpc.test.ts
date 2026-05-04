import { describe, it, expect, vi, beforeEach } from 'vitest'

const gatewayMock = vi.fn()
vi.mock('@/lib/gateway-rpc', () => ({
  gatewayRequest: (...a: any[]) => gatewayMock(...a),
}))

import { POST } from '@/app/api/rpc/route'

function req(body: any) {
  return new Request('http://localhost/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/rpc', () => {
  beforeEach(() => gatewayMock.mockReset())

  it('forwards allowlisted method and returns result', async () => {
    gatewayMock.mockResolvedValue({ agents: [] })
    const res = await POST(req({ method: 'agents.list', params: {} }) as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { agents: [] } })
    expect(gatewayMock).toHaveBeenCalledWith('agents.list', {})
  })

  it('rejects non-allowlisted method with 403', async () => {
    const res = await POST(req({ method: 'system.shutdown' }) as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 on missing method', async () => {
    const res = await POST(req({}) as any)
    expect(res.status).toBe(400)
  })

  it('forwards RPC error as 502 with message', async () => {
    gatewayMock.mockRejectedValueOnce(new Error('missing scope: operator.read'))
    const res = await POST(req({ method: 'agents.list', params: {} }) as any)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'missing scope: operator.read' })
  })
})
