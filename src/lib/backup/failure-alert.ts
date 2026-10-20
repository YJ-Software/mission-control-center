/**
 * 備份連續失敗告警。
 *
 * 計數來源是 backup_logs（同一個 backup_jobs.id 往回數），不用記憶體計數：MCC 重啟不會歸零，
 * 也不必新增欄位。2026-10-13 起本機備份連續失敗 85 次、7 天沒有新備份卻沒有任何通知，這裡補上。
 *
 * 規則：連續失敗第 3 次告警，之後每 12 次（排程每 2 小時，約一天）再告警一次（3、15、27…）；
 * 任何一次成功就歸零，若此前連續失敗已達告警門檻（曾發過告警）就再發一則「已恢復」。
 * 「曾發過告警」由失敗次數推得（≥ 3），不另存狀態。
 *
 * 通知只走既有的通知中心（鈴鐺＋toast），不推外部管道。
 */
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { createNotification } from '@/lib/notifications'
import { backupJobs, backupLogs } from './schema'
import { systemLogJobUrl } from './ui-helpers'

export const FIRST_ALERT_AT = 3
export const REPEAT_ALERT_EVERY = 12
const ERROR_PREVIEW_CHARS = 200

export interface BackupOutcomeRow {
  status: string
  error: string | null
  completedAt: number | null
}

export interface BackupStreak {
  /** 本次（最新一筆已結束）的結果；沒有已結束的紀錄時為 null */
  latest: 'failed' | 'success' | null
  /** 從最新往回數的連續失敗次數（latest 為 success 時為 0） */
  failures: number
  /** latest 為 success 時，它之前那段連續失敗的次數 */
  priorFailures: number
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
  const s: BackupStreak = { latest: null, failures: 0, priorFailures: 0, lastError: null, lastSuccessAt: null }
  for (const r of rows) {
    const o = outcomeOf(r.status)
    if (!o) continue
    if (s.latest === null) {
      s.latest = o
      if (o === 'success') { s.lastSuccessAt = r.completedAt; continue }
    }
    if (o === 'failed') {
      if (s.latest === 'failed') {
        if (s.failures === 0) s.lastError = r.error
        s.failures++
      } else {
        s.priorFailures++
      }
      continue
    }
    // 碰到（更早的）成功：連續失敗到此為止
    if (s.lastSuccessAt === null) s.lastSuccessAt = r.completedAt
    break
  }
  return s
}

export type BackupAlertDecision =
  | { kind: 'failing'; count: number }
  | { kind: 'recovered'; count: number }
  | null

export function decideBackupAlert(s: BackupStreak): BackupAlertDecision {
  if (s.latest === 'failed') {
    const n = s.failures
    if (n >= FIRST_ALERT_AT && (n - FIRST_ALERT_AT) % REPEAT_ALERT_EVERY === 0) return { kind: 'failing', count: n }
    return null
  }
  if (s.latest === 'success' && s.priorFailures >= FIRST_ALERT_AT) {
    return { kind: 'recovered', count: s.priorFailures }
  }
  return null
}

/** 以伺服器本地時區顯示 YYYY-MM-DD HH:mm */
export function formatAlertTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function preview(text: string): string {
  const chars = Array.from(text.trim())
  return chars.length > ERROR_PREVIEW_CHARS ? `${chars.slice(0, ERROR_PREVIEW_CHARS).join('')}…` : chars.join('')
}

/**
 * 在一次備份執行結束（backup_logs 已寫入最終狀態）後呼叫。只看 id ≤ logId 的紀錄，
 * 以本次執行為準。絕不丟錯：告警失敗只記 log，不可影響備份流程。
 */
export function notifyBackupOutcome(opts: { jobId: string; logId: number; runJobId: string | null }): void {
  try {
    const rows = db.select({
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
    const decision = decideBackupAlert(streak)
    if (!decision) return

    const job = db.select({ name: backupJobs.name }).from(backupJobs).where(eq(backupJobs.id, opts.jobId)).get()
    const name = job?.name || opts.jobId
    const link = opts.runJobId ? systemLogJobUrl(opts.runJobId) : '/system-log?tab=jobs'
    const lastOk = streak.lastSuccessAt ? formatAlertTime(streak.lastSuccessAt) : '從未成功'

    if (decision.kind === 'failing') {
      createNotification({
        type: 'backup',
        severity: 'error',
        title: `備份「${name}」已連續失敗 ${decision.count} 次`,
        body: [
          `最後一次錯誤：${streak.lastError ? preview(streak.lastError) : '（沒有錯誤訊息）'}`,
          `最後成功：${lastOk}`,
        ].join('\n'),
        link,
      })
    } else {
      createNotification({
        type: 'backup',
        severity: 'info',
        title: `備份「${name}」已恢復`,
        body: `連續失敗 ${decision.count} 次後，本次備份成功（${lastOk}）。`,
        link,
      })
    }
  } catch (err) {
    console.warn('[Backup] 失敗告警送出失敗：', (err as Error).message)
  }
}
