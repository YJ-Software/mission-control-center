import type { BackupKind } from './archive-format'

/** 備份紀錄的呈現結果：completed 但 error 非空是「完成但有警告」，不是失敗。 */
export type LogOutcome = 'ok' | 'warning' | 'error' | 'other'

export function classifyLogOutcome(status: string, error?: string | null): LogOutcome {
  const hasError = typeof error === 'string' && error.trim() !== ''
  if (status === 'completed') return hasError ? 'warning' : 'ok'
  if (status === 'failed') return 'error'
  return 'other'
}

/** 還原按鈕狀態：只有 mcc 與（舊腳本可用的）legacy-openclaw 可還原；其餘僅供下載／刪除。 */
export type RestoreAction = 'enabled' | 'legacy-disabled' | 'hidden'

export function restoreAction(file: { kind: BackupKind; legacyRestorable: boolean }): RestoreAction {
  if (file.kind === 'mcc') return 'enabled'
  if (file.kind === 'legacy-openclaw') return file.legacyRestorable ? 'enabled' : 'legacy-disabled'
  return 'hidden'
}

/** 系統紀錄中開啟指定工作的網址（job 只在 tab=jobs 時保留）。 */
export function systemLogJobUrl(jobId: string): string {
  return `/system-log?tab=jobs&job=${encodeURIComponent(jobId)}`
}

export interface LastDbRestore {
  result: 'applied' | 'rejected' | 'error'
  at: string
  detail: string
}

export const LAST_DB_RESTORE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 成功套用是「已處理」的資訊，只留 1 天；失敗/拒絕留 7 天。 */
export const LAST_DB_RESTORE_APPLIED_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 只顯示 7 天內的開機還原結果；時間壞掉或在未來太遠視為不顯示。 */
export function recentDbRestore(v: LastDbRestore | null | undefined, now: number = Date.now()): LastDbRestore | null {
  if (!v) return null
  const at = Date.parse(v.at)
  if (!Number.isFinite(at)) return null
  const age = now - at
  const max = v.result === 'applied' ? LAST_DB_RESTORE_APPLIED_MAX_AGE_MS : LAST_DB_RESTORE_MAX_AGE_MS
  if (age > max) return null
  return v
}
