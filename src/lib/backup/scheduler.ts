import { db } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { backupJobs, backupSchedules } from './schema'
import { isDue, nextRunAt } from './next-run'
import { isBackupRunning, BackupBusyError } from './lock'
import type { ScheduleConfig } from './helpers'

export interface SchedulerJob {
  id: string
  enabled: number
  scheduleType: string
  scheduleConfig: ScheduleConfig
}

export interface TickDeps {
  jobs(): SchedulerJob[]
  isRunning(): boolean
  /** 'busy' = 鎖被佔用或有重啟類 job 進行中，該 job 保持待辦、下一 tick 重試 */
  start(jobId: string): 'started' | 'busy'
  log(msg: string): void
}

/** jobId -> 該次排程時刻（到期但尚未啟動的那一次） */
export type PendingMap = ReadonlyMap<string, Date>

/**
 * 純函式（狀態由呼叫端保存）。與 Task 9 簡報相比，簽名多了 pending 輸入與輸出：
 * 到期但因忙碌無法啟動的 job 會留在 pending，每個 tick 重試，直到啟動成功，
 * 或下一次排程時刻到來（記錄一次 skipped 並丟棄，不會補跑兩次）。
 * 全域只有一把鎖，所以每個 tick 最多啟動一個 job。
 */
export function tickBackupScheduler(
  lastTick: Date,
  now: Date,
  deps: TickDeps,
  pending: PendingMap = new Map(),
): { started: string[]; pending: Map<string, Date> } {
  const nextPending = new Map<string, Date>()
  const candidates: string[] = []

  for (const job of deps.jobs()) {
    if (!job.enabled) continue
    try {
      let dueAt = pending.get(job.id)
      if (dueAt && nextRunAt(job.scheduleType, job.scheduleConfig, dueAt) <= now) {
        deps.log(`備份排程 ${job.id}：${dueAt.toISOString()} 的那次因忙碌未能啟動，已被下一次排程取代而略過`)
        dueAt = undefined
      }
      if (!dueAt && isDue(job.scheduleType, job.scheduleConfig, lastTick, now)) {
        dueAt = nextRunAt(job.scheduleType, job.scheduleConfig, lastTick)
      }
      if (dueAt) {
        nextPending.set(job.id, dueAt)
        candidates.push(job.id)
      }
    } catch (err) {
      deps.log(`備份排程 ${job.id} 無法計算下次執行時間：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (candidates.length === 0) return { started: [], pending: nextPending }

  if (deps.isRunning()) {
    deps.log(`備份或還原進行中，${candidates.length} 個到期排程延後重試`)
    return { started: [], pending: nextPending }
  }

  for (const id of candidates) {
    let result: 'started' | 'busy'
    try {
      result = deps.start(id)
    } catch (err) {
      // 不可重試的錯誤（例如 job 已被刪除）：記錄並丟棄，避免每分鐘重複失敗
      deps.log(`備份排程 ${id} 啟動失敗：${err instanceof Error ? err.message : String(err)}`)
      nextPending.delete(id)
      continue
    }
    if (result === 'busy') {
      deps.log(`備份排程 ${id} 暫時無法啟動（忙碌中），下一輪重試`)
      break // 只有一把全域鎖，其餘 job 也一定會忙
    }
    nextPending.delete(id)
    return { started: [id], pending: nextPending }
  }
  return { started: [], pending: nextPending }
}

// ---------------------------------------------------------------------------
// 舊版 agent cron 清理
// ---------------------------------------------------------------------------

const LEGACY_PREFIX = '💾'

export async function removeLegacyBackupCron(deps: {
  list(): Promise<Array<{ id: string; name?: string }>>
  remove(id: string): Promise<void>
  log?(msg: string): void
}): Promise<'removed' | 'none' | 'deferred'> {
  const log = deps.log ?? (() => {})
  let all: Array<{ id: string; name?: string }>
  try {
    all = await deps.list()
  } catch (err) {
    log(`無法列出 cron，稍後重試舊備份排程清理：${err instanceof Error ? err.message : String(err)}`)
    return 'deferred' // 不可吞成 none：取不到資料不等於沒有排程
  }
  const legacy = all.filter((j) => j.name?.startsWith(LEGACY_PREFIX))
  if (legacy.length === 0) return 'none'

  let ok = 0
  for (const j of legacy) {
    try {
      await deps.remove(j.id)
      ok++
    } catch (err) {
      log(`刪除舊備份 cron ${j.id} 失敗：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // 只有全部刪除成功才算 removed；部分失敗要重試（下次重新 list，已刪的不會再出現）
  return ok === legacy.length ? 'removed' : 'deferred'
}

// ---------------------------------------------------------------------------
// 排程器（進程內）
// ---------------------------------------------------------------------------

const TICK_MS = 60_000
// 舊 cron 清理重試的退避間隔。開機時 gateway WebSocket 多半還沒連上（實測 2026-10-06 第一次一定失敗），
// 所以第一次重試要快；若等一小時，舊 cron 會和內建排程在下一個整點各跑一次備份。
const LEGACY_RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000]
const LEGACY_RETRY_MAX_MS = 60 * 60_000
const STARTED_KEY = '__mccBackupSchedulerStarted'

function readJobs(): SchedulerJob[] {
  const rows = db.select().from(backupJobs).all()
  const out: SchedulerJob[] = []
  for (const r of rows) {
    const s = db.select().from(backupSchedules).where(eq(backupSchedules.id, r.scheduleId)).get()
    if (!s) continue
    try {
      out.push({ id: r.id, enabled: r.enabled, scheduleType: s.type, scheduleConfig: JSON.parse(s.config) })
    } catch {
      console.error(`[backup-scheduler] 排程 ${s.id} 的 config 不是合法 JSON，略過`)
    }
  }
  return out
}

async function cleanLegacyOnce(): Promise<boolean> {
  const { cronList, cronRemove } = await import('@/lib/morning-report/cron-cli')
  const r = await removeLegacyBackupCron({
    list: () => cronList(),
    remove: (id) => cronRemove(id),
    log: (m) => console.warn('[backup-scheduler]', m),
  })
  if (r === 'deferred') return false
  db.update(backupJobs).set({ cronJobId: null }).run()
  if (r === 'removed') console.log('[backup-scheduler] 已移除舊版 AI agent 備份 cron')
  return true
}

/** 供測試注入；正式呼叫不帶參數 */
export interface SchedulerStartOpts {
  jobs?: () => SchedulerJob[]
  isRunning?: () => boolean
  /** 同步啟動備份；未提供時於載入 run-backup 後才開始 tick */
  start?: (jobId: string) => 'started' | 'busy'
  now?: () => Date
  /** 回傳 true 表示清理完成（removed/none），false 表示稍後重試 */
  cleanLegacy?: () => Promise<boolean>
  log?: (msg: string) => void
}

export function startBackupScheduler(opts: SchedulerStartOpts = {}): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>
  if (g[STARTED_KEY]) return
  g[STARTED_KEY] = true

  const nowFn = opts.now ?? (() => new Date())
  const log = opts.log ?? ((m: string) => console.log('[backup-scheduler]', m))
  let lastTick = nowFn()
  let pending: Map<string, Date> = new Map()
  log('已啟動；MCC 停機期間錯過的排程不會補跑')

  let startSync: ((id: string) => 'started' | 'busy') | null = opts.start ?? null
  if (!startSync) {
    import('./run-backup').then(({ startBackupRun }) => {
      startSync = (jobId) => {
        try {
          startBackupRun({ jobId, triggeredBy: 'cron' })
          return 'started'
        } catch (err) {
          if (err instanceof BackupBusyError) return 'busy'
          throw err
        }
      }
    }).catch((err) => console.error('[backup-scheduler] 載入 run-backup 失敗:', err))
  }

  const timer = setInterval(() => {
    const now = nowFn()
    try {
      if (!startSync) return // 尚未就緒：不推進 lastTick，視窗保留給下一 tick
      if (now < lastTick) {
        log('偵測到系統時鐘往回調，重設排程基準並略過本次 tick')
        lastTick = now
        return
      }
      const r = tickBackupScheduler(lastTick, now, {
        jobs: opts.jobs ?? readJobs,
        isRunning: opts.isRunning ?? isBackupRunning,
        start: startSync,
        log,
      }, pending)
      pending = r.pending
      for (const id of r.started) log(`已啟動備份 job ${id}`)
      lastTick = now // 只在成功時推進；例外時下一 tick 會重新涵蓋同一視窗
    } catch (err) {
      console.error('[backup-scheduler] tick 失敗，下一輪重試同一視窗:', err)
    }
  }, TICK_MS)
  timer.unref()

  // 舊 cron 清理：deferred 時依退避間隔重試（1、2、5、10、30 分鐘，之後每小時），直到 removed / none
  const clean = opts.cleanLegacy ?? cleanLegacyOnce
  let failures = 0
  const retryLater = () => {
    const delay = LEGACY_RETRY_DELAYS_MS[failures] ?? LEGACY_RETRY_MAX_MS
    failures++
    setTimeout(attempt, delay).unref()
  }
  const attempt = () => {
    clean().then((done) => {
      if (!done) retryLater()
    }).catch((err) => {
      console.error('[backup-scheduler] 舊 cron 清理失敗:', err)
      retryLater()
    })
  }
  attempt()
}
