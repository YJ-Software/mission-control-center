import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rpcCall } from '@/lib/openclaw/rpc-client'

describe('rpcCall', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as any
  })

  it('posts method+params and returns result', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { ok: 1 } }),
    })
    const out = await rpcCall<{ ok: number }>('agents.list', { a: 1 })
    expect(out).toEqual({ ok: 1 })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/rpc',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ method: 'agents.list', params: { a: 1 } }),
      }),
    )
  })

  it('throws with server error message', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'gateway offline' }),
    })
    await expect(rpcCall('agents.list')).rejects.toThrow('gateway offline')
  })
})
