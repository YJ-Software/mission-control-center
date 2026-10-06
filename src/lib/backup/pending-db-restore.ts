import fs from 'fs'
import Database from 'better-sqlite3'

type FsLike = Pick<typeof fs, 'existsSync' | 'renameSync'>

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
): 'applied' | 'none' | 'rejected' {
  const pending = `${dbPath}.restore-pending`
  if (!fsImpl.existsSync(pending)) return 'none'

  const ts = now.toISOString().replace(/[:.]/g, '-')
  if (!isSqliteDbHealthy(pending)) {
    const rejected = `${dbPath}.restore-rejected-${ts}`
    fsImpl.renameSync(pending, rejected)
    console.error(`[Backup] 待還原的資料庫未通過完整性檢查，已拒絕並保留現有資料庫；問題檔案移至 ${rejected}`)
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
  return 'applied'
}

/** 每個行程只檢查一次（server.ts 與 Next bundle 各會載入 db.ts，HMR 也會重跑）。 */
export function applyPendingDbRestoreOnce(dbPath: string): 'applied' | 'none' | 'rejected' {
  const g = globalThis as any
  if (g.__mccPendingDbRestoreChecked) return 'none'
  g.__mccPendingDbRestoreChecked = true
  return applyPendingDbRestore(dbPath)
}
