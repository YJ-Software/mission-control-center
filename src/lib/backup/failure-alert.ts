/**
 * 備份連續失敗告警。
 *
 * 計數來源是 backup_logs（同一個 backup_jobs.id 往回數），不用記憶體計數：MCC 重啟不會歸零，
 * 也不必新增欄位。2026-10-13 起本機備份連續失敗 85 次、7 天沒有新備份卻沒有任何通知，這裡補上。
 *
 * 規則（「達到」門檻，不是「剛好等於」）：本輪連續失敗 ≥ 3 且本輪還沒告警過 → 告警；
 * 本輪告警過 → 距上次告警的次數 ≥ 12（排程每 2 小時，約一天）才再告警。
 * 所以沒經過告警的失敗（開機 reconcile 補成 failed、部署前已累積、告警本身送出失敗）
 * 都會在下一次執行補發，不會靜默到下一個固定序號。
 * 任何一次成功就結束本輪；本輪真的發過告警才再發「已恢復」。
 *
 * 「本輪告警到第幾次」記在通知的 dedup_key：`backup-failing:<jobId>:<本輪最早失敗的 logId>:<當時次數>`。
 * 不新增欄位；使用者刪掉該則通知會讓下一次失敗再補發一則。
 *
 * 通知只走既有的通知中心（鈴鐺＋toast），不推外部管道。
 */
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications } from '@/lib/schema'
import { createNotification } from '@/lib/notifications'
import { backupJobs, backupLogs } from './schema'
import { systemLogJobUrl } from './ui-helpers'

export const FIRST_ALERT_AT = 3
export const REPEAT_ALERT_EVERY = 12
const ERROR_PREVIEW_CHARS = 120

export interface BackupOutcomeRow {
  id: number
  status: string
  error: string | null
  completedAt: number | null
}

export interface BackupStreak {
  /** 最新一筆已結束紀錄的結果；沒有已結束的紀錄時為 null */
  latest: 'failed' | 'success' | null
  latestId: number | null
  /** 從最新往回數的連續失敗次數（latest 為 success 時為 0） */
  failures: number
  /** latest 為 success 時，它之前那段連續失敗的次數 */
  priorFailures: number
  /** 本輪（latest 為 success 時是前一輪）最早那筆失敗的 log id；告警標記用 */
  streakStartId: number | null
  /** 最新一筆失敗的錯誤訊息（backup_logs.error，寫入前已遮罩） */
  lastError: string | null
  /** 最近一次成功的完成時間（unix 秒） */
  lastSuccessAt: number | null
}

/** completed（含有警告）是成功；canceled 只由 retention 產生，是檔案被輪替掉的過去成功。 */
function outcomeOf(status: string): 'failed' | 'success' | null {
  if (status === 'failed') return 'failed'
  if (status === 'completed' || status === 'canceled') return 'success'
  return null // pending / processing：尚未結束，不算
}

/** rows 必須由新到舊排序。 */
export function summarizeBackupStreak(rows: BackupOutcomeRow[]): BackupStreak {
  const s: BackupStreak = {
    latest: null, latestId: null, failures: 0, priorFailures: 0, streakStartId: null, lastError: null, lastSuccessAt: null,
  }
  for (const r of rows) {
    const o = outcomeOf(r.status)
    if (!o) continue
    if (s.latest === null) {
      s.latest = o
      s.latestId = r.id
      if (o === 'success') { s.lastSuccessAt = r.completedAt; continue }
    }
    if (o === 'failed') {
      if (s.latest === 'failed') {
        if (s.failures === 0) s.lastError = r.error
        s.failures++
      } else {
        s.priorFailures++
      }
      s.streakStartId = r.id
      continue
    }
    // 碰到（更早的）成功：這一輪到此為止
    if (s.lastSuccessAt === null) s.lastSuccessAt = r.completedAt
    break
  }
  return s
}

export type BackupAlertDecision =
  | { kind: 'failing'; count: number }
  | { kind: 'recovered'; count: number }
  | null

/**
 * @param lastAlertedCount 本輪（latest 為 success 時是前一輪）最後一次失敗告警當時的連續失敗次數；
 *   沒告警過為 null。
 */
export function decideBackupAlert(s: BackupStreak, lastAlertedCount: number | null): BackupAlertDecision {
  if (s.latest === 'failed') {
    const n = s.failures
    if (n < FIRST_ALERT_AT) return null
    if (lastAlertedCount === null || n - lastAlertedCount >= REPEAT_ALERT_EVERY) return { kind: 'failing', count: n }
    return null
  }
  if (s.latest === 'success' && s.priorFailures > 0 && lastAlertedCount !== null) {
    return { kind: 'recovered', count: s.priorFailures }
  }
  return null
}

function failingKeyPrefix(jobId: string, streakStartId: number): string {
  return `backup-failing:${jobId}:${streakStartId}:`
}

/** 從通知中心找本輪最後一次失敗告警的次數 */
function lastAlertedCountFor(jobId: string, streakStartId: number): number | null {
  const prefix = failingKeyPrefix(jobId, streakStartId)
  const keys = db.select({ k: notifications.dedupKey }).from(notifications)
    .where(eq(notifications.type, 'backup'))
    .all()
  let max: number | null = null
  for (const { k } of keys) {
    if (!k || !k.startsWith(prefix)) continue
    const n = Number(k.slice(prefix.length))
    if (Number.isInteger(n) && (max === null || n > max)) max = n
  }
  return max
}

/** 以伺服器本地時區顯示 MM/DD HH:mm（非今年加上年份） */
export function formatAlertTime(unixSeconds: number, now: Date = new Date()): string {
  const d = new Date(unixSeconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const md = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`
}

/** 單行預覽：換行與連續空白壓成一個空白，取前 120 字 */
function preview(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > ERROR_PREVIEW_CHARS ? `${chars.slice(0, ERROR_PREVIEW_CHARS).join('')}…` : chars.join('')
}

/**
 * 在一次備份執行結束（backup_logs 已寫入最終狀態）後呼叫。只看 id ≤ logId 的紀錄，
 * 且本次 row 必須已是最終狀態，否則不判斷。絕不丟錯：告警失敗只記 log，不可影響備份流程。
 */
export function notifyBackupOutcome(opts: { jobId: string; logId: number; runJobId: string | null }): void {
  try {
    const rows = db.select({
      id: backupLogs.id,
      status: backupLogs.status,
      error: backupLogs.error,
      completedAt: backupLogs.completedAt,
    }).from(backupLogs)
      .where(and(
        eq(backupLogs.jobId, opts.jobId),
        lte(backupLogs.id, opts.logId),
        inArray(backupLogs.status, ['failed', 'completed', 'canceled']),
      ))
      .orderBy(desc(backupLogs.id))
      .all()
    const streak = summarizeBackupStreak(rows)
    // 本次 row 沒寫成最終狀態（例如 failRun 的 DB 更新失敗）：不拿上一筆來判斷，避免重發
    if (streak.latestId !== opts.logId || streak.streakStartId === null) return
    const lastAlerted = lastAlertedCountFor(opts.jobId, streak.streakStartId)
    const decision = decideBackupAlert(streak, lastAlerted)
    if (!decision) return

    const job = db.select({ name: backupJobs.name }).from(backupJobs).where(eq(backupJobs.id, opts.jobId)).get()
    const name = job?.name || opts.jobId
    const link = opts.runJobId ? systemLogJobUrl(opts.runJobId) : '/system-log?tab=jobs'

    if (decision.kind === 'failing') {
      // 鈴鐺清單是 line-clamp-2 且不保留換行：單行短句，次數與最後成功放在錯誤之前
      const lastOk = streak.lastSuccessAt ? `最後成功 ${formatAlertTime(streak.lastSuccessAt)}` : '從未成功'
      const err = streak.lastError ? preview(streak.lastError) : '（沒有錯誤訊息）'
      createNotification({
        type: 'backup',
        severity: 'error',
        title: `備份「${name}」已連續失敗 ${decision.count} 次`,
        body: `連續失敗 ${decision.count} 次｜${lastOk}｜${err}`,
        link,
        dedupKey: `${failingKeyPrefix(opts.jobId, streak.streakStartId)}${decision.count}`,
      })
    } else {
      const okAt = streak.lastSuccessAt ? `｜本次成功 ${formatAlertTime(streak.lastSuccessAt)}` : ''
      createNotification({
        type: 'backup',
        severity: 'info',
        title: `備份「${name}」已恢復`,
        body: `連續失敗 ${decision.count} 次後恢復${okAt}`,
        link,
        dedupKey: `backup-recovered:${opts.jobId}:${opts.logId}`,
      })
    }
  } catch (err) {
    console.warn('[Backup] 失敗告警送出失敗：', (err as Error).message)
  }
}
