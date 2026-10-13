import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tickBackupScheduler, removeLegacyBackupCron, cleanLegacyBackupCron, startBackupScheduler, requestLegacyBackupCronRecheck, LEGACY_CRON_CLEANED_KEY, type SchedulerJob } from '@/lib/backup/scheduler'

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
  it('只刪舊 sync-cron 產生的「💾 Backup:」開頭；使用者自己的 💾 cron 不動', async () => {
    const remove = vi.fn(async (_id: string) => {})
    const r = await removeLegacyBackupCron({
      list: async () => [
        { id: '1', name: '💾 Backup: x' }, { id: '2', name: '晨報' }, { id: '3' }, { id: '4', name: '💾 Backup: y' },
        { id: '5', name: '💾 相簿同步' }, { id: '6', name: '💾 Backups weekly' }, { id: '7', name: 'x 💾 Backup: z' },
      ],
      remove,
    })
    expect(r).toBe('removed')
    expect(remove.mock.calls.map(c => c[0])).toEqual(['1', '4'])
  })
  it('沒有舊備份 cron（只有使用者的 💾 cron）→ none', async () => {
    const remove = vi.fn()
    expect(await removeLegacyBackupCron({ list: async () => [{ id: '2', name: 'x' }, { id: '5', name: '💾 相簿同步' }], remove })).toBe('none')
    expect(remove).not.toHaveBeenCalled()
  })
  it('單一 remove 失敗不影響其他，且有記錄', async () => {
    const log = vi.fn()
    const remove = vi.fn(async (id: string) => { if (id === '1') throw new Error('x') })
    await removeLegacyBackupCron({ list: async () => [{ id: '1', name: '💾 Backup: a' }, { id: '2', name: '💾 Backup: b' }], remove, log })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
  })
  it('部分失敗 → deferred（會重試）', async () => {
    const r = await removeLegacyBackupCron({
      list: async () => [{ id: '1', name: '💾 Backup: a' }, { id: '2', name: '💾 Backup: b' }],
      remove: async (id: string) => { if (id === '2') throw new Error('x') },
    })
    expect(r).toBe('deferred')
  })
  it('全部 remove 失敗 → deferred（之後重試）', async () => {
    const r = await removeLegacyBackupCron({
      list: async () => [{ id: '1', name: '💾 Backup: a' }], remove: async () => { throw new Error('x') },
    })
    expect(r).toBe('deferred')
  })
})

describe('cleanLegacyBackupCron（settings 旗標：清理成功後之後的開機不再處理）', () => {
  const mkFlag = (initial: boolean) => {
    const st = { cleaned: initial }
    return { st, isCleaned: vi.fn(() => st.cleaned), markCleaned: vi.fn(() => { st.cleaned = true }) }
  }
  it('旗標 key 是 backup.legacyCronCleaned', () => {
    expect(LEGACY_CRON_CLEANED_KEY).toBe('backup.legacyCronCleaned')
  })
  it('已清理過：不 list、不 remove，直接完成', async () => {
    const f = mkFlag(true)
    const list = vi.fn(async () => [{ id: '1', name: '💾 Backup: x' }])
    const remove = vi.fn(async () => {})
    const onDone = vi.fn()
    expect(await cleanLegacyBackupCron({ ...f, list, remove, onDone })).toBe(true)
    expect(list).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
  it('removed → 記旗標、onDone；下一次開機不再 list', async () => {
    const f = mkFlag(false)
    const list = vi.fn(async () => [{ id: '1', name: '💾 Backup: x' }])
    const onDone = vi.fn()
    expect(await cleanLegacyBackupCron({ ...f, list, remove: async () => {}, onDone })).toBe(true)
    expect(f.markCleaned).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(await cleanLegacyBackupCron({ ...f, list, remove: async () => {}, onDone })).toBe(true)
    expect(list).toHaveBeenCalledTimes(1)
  })
  it('none → 也記旗標', async () => {
    const f = mkFlag(false)
    expect(await cleanLegacyBackupCron({ ...f, list: async () => [], remove: async () => {} })).toBe(true)
    expect(f.markCleaned).toHaveBeenCalledTimes(1)
  })
  it('deferred（list 失敗或部分刪除失敗）→ 不記旗標、回 false 以便重試', async () => {
    const f = mkFlag(false)
    expect(await cleanLegacyBackupCron({ ...f, list: async () => { throw new Error('gateway down') }, remove: async () => {} })).toBe(false)
    expect(await cleanLegacyBackupCron({
      ...f, list: async () => [{ id: '1', name: '💾 Backup: x' }], remove: async () => { throw new Error('x') },
    })).toBe(false)
    expect(f.markCleaned).not.toHaveBeenCalled()
  })
  it('旗標寫不進去也算完成（下次開機重跑一次無害）', async () => {
    const log = vi.fn()
    const r = await cleanLegacyBackupCron({
      isCleaned: () => false, markCleaned: () => { throw new Error('SQLITE_BUSY') },
      list: async () => [], remove: async () => {}, log,
    })
    expect(r).toBe(true)
    expect(log).toHaveBeenCalled()
  })
})

describe('startBackupScheduler', () => {
  const KEY = '__mccBackupSchedulerStarted'
  let clock: Date
  const nowFn = () => new Date(clock)
  const advance = async (ms: number) => { clock = new Date(clock.getTime() + ms); await vi.advanceTimersByTimeAsync(ms) }
  beforeEach(() => {
    vi.useFakeTimers()
    delete (globalThis as Record<string, unknown>)[KEY]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    clock = at(2, 59)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>)[KEY]
  })
  const base = (over: Record<string, unknown> = {}) => {
    const start = vi.fn<(id: string) => 'started' | 'busy'>(() => 'started')
    return { start, opts: { jobs: () => [daily('a')], isRunning: () => false, start, now: nowFn, log: () => {}, cleanLegacy: async () => true, ...over } }
  }

  it('冪等：第二次呼叫不會再建 timer / 再清理', () => {
    const clean = vi.fn(async () => true)
    const b = base({ cleanLegacy: clean })
    startBackupScheduler(b.opts)
    startBackupScheduler(b.opts)
    expect(clean).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
  })
  it('開機視窗：啟動後第一個 tick 前到期的排程仍會啟動', async () => {
    const b = base()
    startBackupScheduler(b.opts)
    await advance(60_000) // 02:59 -> 03:00
    expect(b.start).toHaveBeenCalledWith('a')
  })
  it('tick 例外不會殺掉 interval，也不推進 lastTick（下一輪仍涵蓋該視窗）', async () => {
    let fail = true
    const b = base({ jobs: () => { if (fail) throw new Error('SQLITE_BUSY'); return [daily('a')] } })
    startBackupScheduler(b.opts)
    await advance(60_000) // 03:00 tick 失敗
    expect(b.start).not.toHaveBeenCalled()
    fail = false
    await advance(60_000) // 03:01：視窗仍從 02:59 起，涵蓋 03:00
    expect(b.start).toHaveBeenCalledTimes(1)
  })
  it('時鐘往回調：重設基準並略過該 tick，不重複執行', async () => {
    const b = base()
    startBackupScheduler(b.opts)
    await advance(60_000) // 03:00 啟動
    expect(b.start).toHaveBeenCalledTimes(1)
    clock = new Date(clock.getTime() - 10 * 60_000) // 回調到 02:51
    await vi.advanceTimersByTimeAsync(60_000)
    clock = new Date(clock.getTime() + 60_000)
    await advance(60_000 * 5)
    expect(b.start).toHaveBeenCalledTimes(1)
  })
  it('舊 cron 清理 deferred：1、2、5、10、30 分鐘後退避重試，之後每小時，直到成功', async () => {
    // 開機時 gateway 多半還沒連上：第一次重試必須很快，否則舊 cron 會和內建排程在下一個整點各跑一次
    const clean = vi.fn<() => Promise<boolean>>()
    for (let i = 0; i < 6; i++) clean.mockResolvedValueOnce(false)
    clean.mockResolvedValueOnce(true)
    const b = base({ cleanLegacy: clean, jobs: () => [] })
    startBackupScheduler(b.opts)
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(1)
    await advance(59_000)
    expect(clean).toHaveBeenCalledTimes(1)
    await advance(1_000)
    expect(clean).toHaveBeenCalledTimes(2)
    await advance(2 * 60_000)
    expect(clean).toHaveBeenCalledTimes(3)
    await advance(5 * 60_000)
    expect(clean).toHaveBeenCalledTimes(4)
    await advance(10 * 60_000)
    expect(clean).toHaveBeenCalledTimes(5)
    await advance(30 * 60_000)
    expect(clean).toHaveBeenCalledTimes(6)
    await advance(59 * 60_000)
    expect(clean).toHaveBeenCalledTimes(6)
    await advance(60_000)
    expect(clean).toHaveBeenCalledTimes(7)
    await advance(3 * 60 * 60_000)
    expect(clean).toHaveBeenCalledTimes(7)
  })
})

describe('M4：還原後重新檢查舊版備份 cron（requestLegacyBackupCronRecheck）', () => {
  const KEY = '__mccBackupSchedulerStarted'
  const RECHECK = '__mccLegacyCronRecheck'
  beforeEach(() => {
    vi.useFakeTimers()
    delete (globalThis as Record<string, unknown>)[KEY]
    delete (globalThis as Record<string, unknown>)[RECHECK]
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>)[KEY]
    delete (globalThis as Record<string, unknown>)[RECHECK]
  })
  const opts = (clean: () => Promise<boolean>) => ({
    jobs: () => [], isRunning: () => false, start: () => 'started' as const, log: () => {}, cleanLegacy: clean,
  })

  it('旗標已清理、排程器已跑完清理 → 還原後清旗標並立刻再跑一次清理（不必等重啟）', async () => {
    const flag = { cleaned: false }
    const list = vi.fn(async () => [{ id: 'c1', name: '💾 Backup: nightly' }])
    const clean = vi.fn(() => cleanLegacyBackupCron({
      isCleaned: () => flag.cleaned, markCleaned: () => { flag.cleaned = true }, list, remove: async () => {},
    }))
    startBackupScheduler(opts(clean))
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)
    expect(flag.cleaned).toBe(true)
    // 之後的檢查都直接跳過（這就是還原後舊 cron 復活卻沒人管的原因）
    requestLegacyBackupCronRecheck({ clearFlag: () => { flag.cleaned = false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalledTimes(2)
    expect(flag.cleaned).toBe(true)
  })
  it('排程器沒在這個行程啟動：只清旗標、不丟錯（下次開機會掃）', () => {
    const clearFlag = vi.fn()
    expect(() => requestLegacyBackupCronRecheck({ clearFlag })).not.toThrow()
    expect(clearFlag).toHaveBeenCalledTimes(1)
  })
  it('清旗標失敗也不丟錯，仍觸發清理', async () => {
    const clean = vi.fn(async () => true)
    startBackupScheduler(opts(clean))
    await vi.advanceTimersByTimeAsync(0)
    const log = vi.fn()
    expect(() => requestLegacyBackupCronRecheck({ clearFlag: () => { throw new Error('SQLITE_BUSY') }, log })).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalled()
  })
  it('退避重試等待中被觸發：立刻跑、退避歸零，舊的計時器不會多跑一次', async () => {
    const clean = vi.fn<() => Promise<boolean>>()
    clean.mockResolvedValueOnce(false) // 開機：deferred，排 1 分鐘後重試
    clean.mockResolvedValue(true)
    startBackupScheduler(opts(clean))
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(1)
    requestLegacyBackupCronRecheck({ clearFlag: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(clean).toHaveBeenCalledTimes(2)
  })
  it('清理進行中被觸發：等它結束後再清一次旗標、再跑一次（避免進行中的那次把旗標記回已清理）', async () => {
    let resolveFirst!: (v: boolean) => void
    const clean = vi.fn<() => Promise<boolean>>()
    clean.mockImplementationOnce(() => new Promise<boolean>((r) => { resolveFirst = r }))
    clean.mockResolvedValue(true)
    startBackupScheduler(opts(clean))
    await vi.advanceTimersByTimeAsync(0)
    const clearFlag = vi.fn()
    requestLegacyBackupCronRecheck({ clearFlag })
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(1)
    resolveFirst(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(clean).toHaveBeenCalledTimes(2)
    expect(clearFlag).toHaveBeenCalledTimes(2)
  })
})
