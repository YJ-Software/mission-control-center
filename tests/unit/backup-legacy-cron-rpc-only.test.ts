import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 開機／還原後的舊備份 cron 清理只能採信 gateway RPC 的結果（m4）。
// db 以最小 stub 取代，避免測試開到真實 ~/.mission-control/db.sqlite。
const store = new Map<string, string>()
vi.mock('@/lib/db', () => {
  const chain = (ret: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ['from', 'where', 'set', 'values', 'onConflictDoUpdate']) c[k] = () => c
    c.get = ret
    c.all = () => []
    c.run = () => {}
    return c
  }
  return {
    db: {
      select: () => chain(() => (store.has('backup.legacyCronCleaned') ? { value: store.get('backup.legacyCronCleaned') } : undefined)),
      insert: () => { const c = chain(() => undefined); c.run = () => { store.set('backup.legacyCronCleaned', '1') }; return c },
      update: () => chain(() => undefined),
      delete: () => chain(() => undefined),
    },
  }
})
const cronList = vi.fn()
const cronRemove = vi.fn(async () => {})
vi.mock('@/lib/morning-report/cron-cli', () => ({ cronList, cronRemove }))

import { startBackupScheduler } from '@/lib/backup/scheduler'

describe('舊備份 cron 清理只接受 RPC 來源', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store.clear()
    cronList.mockReset()
    delete (globalThis as Record<string, unknown>).__mccBackupSchedulerStarted
    delete (globalThis as Record<string, unknown>).__mccLegacyCronRecheck
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as Record<string, unknown>).__mccBackupSchedulerStarted
    delete (globalThis as Record<string, unknown>).__mccLegacyCronRecheck
  })

  it('以 allowFileFallback: false 呼叫 cronList；RPC 失敗 → 不記旗標、1 分鐘後重試', async () => {
    cronList.mockRejectedValueOnce(new Error('gateway down'))
    cronList.mockResolvedValue([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    startBackupScheduler({ jobs: () => [], isRunning: () => false, start: () => 'started', log: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(cronList).toHaveBeenCalledWith({ allowFileFallback: false })
    expect(store.has('backup.legacyCronCleaned')).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cronList).toHaveBeenCalledTimes(2)
    expect(store.get('backup.legacyCronCleaned')).toBe('1')
    warn.mockRestore()
  })
})
