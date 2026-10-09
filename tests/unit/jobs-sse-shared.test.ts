import { describe, it, expect, vi, afterEach } from 'vitest'

// server.ts bundle（排程器）與 Next bundle（SSE route）各自載入一份 sse.ts：
// emitter 必須放在 globalThis，排程器啟動的 job 才會串流到 System Log。
describe('job SSE emitter 跨模組實例共用', () => {
  afterEach(() => { vi.resetModules() })

  it('另一份模組實例 emit 的事件，訂閱端收得到', async () => {
    vi.resetModules()
    const a = await import('@/lib/jobs/sse')
    vi.resetModules()
    const b = await import('@/lib/jobs/sse')
    expect(a).not.toBe(b) // 確實是兩份模組實例

    const got: string[] = []
    const offJob = a.subscribeJob('j-shared', (ev) => got.push(`job:${ev.type}`))
    const offAll = a.subscribeAll((ev) => got.push(`all:${ev.jobId}`))
    const meta = { id: 'j-shared' } as never
    b.emitJobEvent({ type: 'end', jobId: 'j-shared', meta })
    offJob(); offAll()
    expect(got).toEqual(['all:j-shared', 'job:end'])

    // 取消訂閱也跨實例生效
    b.emitJobEvent({ type: 'end', jobId: 'j-shared', meta })
    expect(got).toHaveLength(2)
  })
})
