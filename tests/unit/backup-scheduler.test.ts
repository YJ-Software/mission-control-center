import { describe, it, expect, vi } from 'vitest'
import { tickBackupScheduler, removeLegacyBackupCron, type SchedulerJob } from '@/lib/backup/scheduler'

const daily = (id: string, time = '03:00', enabled = 1): SchedulerJob => ({
  id, enabled, scheduleType: 'daily', scheduleConfig: { days: [0, 1, 2, 3, 4, 5, 6], time } as never,
})
const at = (h: number, m: number, d = 10) => new Date(2026, 9, d, h, m, 0, 0)

function mk(jobs: SchedulerJob[], over: Partial<Parameters<typeof tickBackupScheduler>[2]> = {}) {
  const start = vi.fn<(id: string) => 'started' | 'busy'>(() => 'started')
  const log = vi.fn()
  return { start, log, deps: { jobs: () => jobs, isRunning: () => false, start, log, ...over } }
}

describe('tickBackupScheduler', () => {
  it('到期才啟動', () => {
    const m = mk([daily('a')])
    expect(tickBackupScheduler(at(2, 58), at(2, 59), m.deps).started).toEqual([])
    expect(tickBackupScheduler(at(2, 59), at(3, 0), m.deps).started).toEqual(['a'])
    expect(m.start).toHaveBeenCalledTimes(1)
  })
  it('停用的不啟動', () => {
    const m = mk([daily('a', '03:00', 0)])
    expect(tickBackupScheduler(at(2, 59), at(3, 0), m.deps).started).toEqual([])
    expect(m.start).not.toHaveBeenCalled()
  })
  it('running 時不啟動，留在 pending，之後閒下來就啟動', () => {
    let running = true
    const m = mk([daily('a')], { isRunning: () => running })
    const r1 = tickBackupScheduler(at(2, 59), at(3, 0), m.deps)
    expect(r1.started).toEqual([])
    expect(r1.pending.has('a')).toBe(true)
    expect(m.log).toHaveBeenCalled()
    running = false
    const r2 = tickBackupScheduler(at(3, 0), at(3, 1), m.deps, r1.pending)
    expect(r2.started).toEqual(['a'])
    expect(r2.pending.size).toBe(0)
  })
  it('start 回 busy：保持 pending 並重試；之後成功只跑一次', () => {
    const m = mk([daily('a')])
    m.start.mockReturnValueOnce('busy')
    const r1 = tickBackupScheduler(at(2, 59), at(3, 0), m.deps)
    expect(r1.started).toEqual([])
    expect(r1.pending.has('a')).toBe(true)
    const r2 = tickBackupScheduler(at(3, 0), at(3, 1), m.deps, r1.pending)
    expect(r2.started).toEqual(['a'])
    const r3 = tickBackupScheduler(at(3, 1), at(3, 2), m.deps, r2.pending)
    expect(r3.started).toEqual([])
    expect(m.start).toHaveBeenCalledTimes(2)
  })
  it('下一次排程到來時：記錄略過一次並丟棄舊的，不會跑兩次', () => {
    const m = mk([daily('a')])
    m.start.mockReturnValue('busy')
    let r = tickBackupScheduler(at(2, 59), at(3, 0), m.deps)
    r = tickBackupScheduler(at(3, 0), at(12, 0), m.deps, r.pending)
    expect(r.pending.has('a')).toBe(true) // 仍在等 3:00 那次
    m.log.mockClear()
    m.start.mockReturnValue('started')
    // 隔天 3:00 到來：舊的被取代、新的啟動，總共一次
    r = tickBackupScheduler(at(12, 0), at(3, 0, 11), m.deps, r.pending)
    expect(m.log.mock.calls.filter(c => String(c[0]).includes('略過'))).toHaveLength(1)
    expect(r.started).toEqual(['a'])
    expect(r.pending.size).toBe(0)
  })
  it('同一 tick 多個到期只啟動第一個，其餘留 pending', () => {
    const m = mk([daily('a'), daily('b')])
    const r = tickBackupScheduler(at(2, 59), at(3, 0), m.deps)
    expect(r.started).toEqual(['a'])
    expect(r.pending.has('b')).toBe(true)
    const r2 = tickBackupScheduler(at(3, 0), at(3, 1), m.deps, r.pending)
    expect(r2.started).toEqual(['b'])
  })
  it('start 拋錯（例如 job 不存在）：記錄並丟棄，改試下一個', () => {
    const m = mk([daily('a'), daily('b')])
    m.start.mockImplementationOnce(() => { throw new Error('Job not found') })
    const r = tickBackupScheduler(at(2, 59), at(3, 0), m.deps)
    expect(r.started).toEqual(['b'])
    expect(r.pending.has('a')).toBe(false)
  })
  it('停用後 pending 被清掉', () => {
    const m = mk([daily('a', '03:00', 0)])
    const r = tickBackupScheduler(at(3, 0), at(3, 1), m.deps, new Map([['a', at(3, 0)]]))
    expect(r.pending.size).toBe(0)
    expect(m.start).not.toHaveBeenCalled()
  })
})

describe('removeLegacyBackupCron', () => {
  it('list 拋錯 → deferred，且不呼叫 remove', async () => {
    const remove = vi.fn()
    const r = await removeLegacyBackupCron({ list: async () => { throw new Error('gateway down') }, remove })
    expect(r).toBe('deferred')
    expect(remove).not.toHaveBeenCalled()
  })
  it('只刪 💾 開頭的', async () => {
    const remove = vi.fn(async (_id: string) => {})
    const r = await removeLegacyBackupCron({
      list: async () => [{ id: '1', name: '💾 Backup: x' }, { id: '2', name: '晨報' }, { id: '3' }, { id: '4', name: '💾 Backup: y' }],
      remove,
    })
    expect(r).toBe('removed')
    expect(remove.mock.calls.map(c => c[0])).toEqual(['1', '4'])
  })
  it('沒有 💾 → none', async () => {
    expect(await removeLegacyBackupCron({ list: async () => [{ id: '2', name: 'x' }], remove: vi.fn() })).toBe('none')
  })
  it('單一 remove 失敗不影響其他，至少一個成功 → removed 並記錄', async () => {
    const log = vi.fn()
    const remove = vi.fn(async (id: string) => { if (id === '1') throw new Error('x') })
    const r = await removeLegacyBackupCron({
      list: async () => [{ id: '1', name: '💾 a' }, { id: '2', name: '💾 b' }], remove, log,
    })
    expect(r).toBe('removed')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
  })
  it('全部 remove 失敗 → deferred（之後重試）', async () => {
    const r = await removeLegacyBackupCron({
      list: async () => [{ id: '1', name: '💾 a' }], remove: async () => { throw new Error('x') },
    })
    expect(r).toBe('deferred')
  })
})
