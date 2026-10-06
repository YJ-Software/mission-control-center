import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

type FsLike = Pick<typeof fs, 'existsSync' | 'renameSync' | 'statSync'>

/** 待還原檔超過此時間就視為過期：避免數週後的某次重啟默默把資料庫倒回舊備份 */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000

/** 以唯讀連線跑 PRAGMA quick_check；打不開或結果不是 ok 都視為不健康。 */
export function isSqliteDbHealthy(file: string): boolean {
  let conn: Database.Database | undefined
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true })
    return conn.pragma('quick_check', { simple: true }) === 'ok'
  } catch {
    return false
  } finally {
    try { conn?.close() } catch { /* ignore */ }
  }
}

const SUFFIXES = ['', '-wal', '-shm']

/**
 * 注意：目前只有 server.ts 會 import db.ts。若日後有獨立腳本 import db.ts，
 * 它會在 server 執行中套用待還原檔，把 db 在連線底下換掉。
 *
 * 啟動時套用已排程的資料庫還原。必須在開啟 SQLite 連線之前呼叫；
 * 不得 import db.ts（會造成循環並提早開連線）。
 */
export function applyPendingDbRestore(
  dbPath: string,
  fsImpl: FsLike = fs,
  now: Date = new Date(),
  report?: { detail?: string },
): 'applied' | 'none' | 'rejected' {
  const pending = `${dbPath}.restore-pending`
  if (!fsImpl.existsSync(pending)) return 'none'

  const ts = now.toISOString().replace(/[:.]/g, '-')
  const ageMs = now.getTime() - fsImpl.statSync(pending).mtimeMs
  if (ageMs > PENDING_MAX_AGE_MS) {
    const rejected = `${dbPath}.restore-rejected-${ts}`
    fsImpl.renameSync(pending, rejected)
    const msg = `待還原的資料庫已排程超過 1 小時（${Math.round(ageMs / 60000)} 分鐘），視為過期並拒絕，保留現有資料庫；檔案移至 ${rejected}`
    console.error(`[Backup] ${msg}`)
    if (report) report.detail = msg
    return 'rejected'
  }
  if (!isSqliteDbHealthy(pending)) {
    const rejected = `${dbPath}.restore-rejected-${ts}`
    fsImpl.renameSync(pending, rejected)
    const msg = `待還原的資料庫未通過完整性檢查，已拒絕並保留現有資料庫；問題檔案移至 ${rejected}`
    console.error(`[Backup] ${msg}`)
    if (report) report.detail = msg
    return 'rejected'
  }
  // 清掉 pending 旁殘留的 -wal/-shm，避免換進來後被當成 db 的日誌
  for (const suf of ['-wal', '-shm']) fs.rmSync(`${pending}${suf}`, { force: true })
  const moved: Array<[string, string]> = []
  try {
    for (const suf of SUFFIXES) {
      const from = `${dbPath}${suf}`
      if (!fsImpl.existsSync(from)) continue
      const to = `${from}.pre-restore-${ts}`
      fsImpl.renameSync(from, to)
      moved.push([from, to])
    }
    fsImpl.renameSync(pending, dbPath)
  } catch (err) {
    for (const [from, to] of moved.reverse()) {
      try { fsImpl.renameSync(to, from) } catch { /* best effort */ }
    }
    throw err
  }
  if (report) report.detail = `已套用待還原的資料庫；舊資料庫保留為 ${dbPath}.pre-restore-${ts}`
  return 'applied'
}

/** 記錄開機時套用結果，供 UI 顯示；寫入失敗不可影響啟動。 */
export function writeLastDbRestore(
  dbPath: string,
  result: 'applied' | 'rejected' | 'error',
  detail: string,
  now: Date = new Date(),
): void {
  try {
    const target = path.join(path.dirname(dbPath), 'last-db-restore.json')
    const tmp = `${target}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ result, at: now.toISOString(), detail }, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, target)
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
      throw e
    }
  } catch { /* ignore */ }
}

/** 每個行程只檢查一次（server.ts 與 Next bundle 各會載入 db.ts，HMR 也會重跑）。 */
export function applyPendingDbRestoreOnce(dbPath: string): 'applied' | 'none' | 'rejected' {
  const g = globalThis as any
  if (g.__mccPendingDbRestoreChecked) return 'none'
  g.__mccPendingDbRestoreChecked = true
  const report: { detail?: string } = {}
  try {
    const r = applyPendingDbRestore(dbPath, fs, new Date(), report)
    if (r !== 'none') writeLastDbRestore(dbPath, r, report.detail ?? '')
    return r
  } catch (err) {
    writeLastDbRestore(dbPath, 'error', `套用待還原資料庫時發生錯誤：${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}
