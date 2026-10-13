import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { isSqliteDbHealthy } from './pending-db-restore'

/** 以新開的唯讀連線做線上快照（含 WAL 內尚未 checkpoint 的資料）。 */
export async function snapshotMccDb(srcPath: string, destPath: string): Promise<void> {
  const src = new Database(srcPath, { readonly: true })
  try {
    await src.backup(destPath)
  } finally {
    src.close()
  }
  // 轉成 DELETE 模式，讓快照是單一自足檔案，不會帶 -wal/-shm
  const snap = new Database(destPath)
  try {
    snap.pragma('journal_mode = DELETE')
  } finally {
    snap.close()
  }
  fs.chmodSync(destPath, 0o600)
}

/**
 * 快照是在備份進行中拍的，這筆備份自己的 backup_logs 在快照裡仍是 processing；
 * 還原後啟動時的殘留修復會把它標成「中斷」的 failed，每次還原都多一筆假的失敗。
 * 能拿來還原就代表最終備份檔存在，所以在快照內把它記為 completed 並指向最終路徑。
 */
export function markBackupRowInSnapshot(snapshotPath: string, logId: number, finalPath: string, completedAt: number): void {
  const snap = new Database(snapshotPath)
  try {
    snap.prepare(
      "UPDATE backup_logs SET status = 'completed', file_path = ?, completed_at = ?, error = NULL WHERE id = ? AND status = 'processing'",
    ).run(finalPath, completedAt, logId)
  } finally {
    snap.close()
  }
}

/** 來源存在才複製，權限 600；回傳是否有複製。 */
export function copyEnvFile(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false
  const data = fs.readFileSync(src)
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
  // 先移除既有檔，確保新檔從建立起就是 600，不會有世界可讀的空窗
  fs.rmSync(dest, { force: true })
  fs.writeFileSync(dest, data, { mode: 0o600 })
  fs.chmodSync(dest, 0o600) // 以防 umask 或其他干擾
  return true
}

const pendingOf = (dbPath: string) => `${dbPath}.restore-pending`

/**
 * 第一步（在動任何現行資料之前）：驗證快照並複製成 <pending>.tmp。
 * 空間不足、權限等會失敗的步驟都在這裡；失敗時不留 .tmp。
 */
export function preparePendingDbRestore(snapshotPath: string, dbPath: string, archivePath?: string): void {
  if (!isSqliteDbHealthy(snapshotPath)) {
    throw new Error(`備份中的資料庫快照無法通過完整性檢查，已拒絕排程還原：${snapshotPath}`)
  }
  const tmp = `${pendingOf(dbPath)}.tmp`
  try {
    fs.copyFileSync(snapshotPath, tmp)
    fs.chmodSync(tmp, 0o600)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  if (archivePath) {
    // 純顯示資訊：補不上也照常還原
    try { fillRestoredBackupRow(tmp, archivePath, dbPath) } catch { /* ignore */ }
  }
}

/**
 * 快照拍在打包之前，這筆備份自己的 backup_logs 列在快照裡沒有 file_size，
 * 也沒有之後才知道的 extra_file_paths、警告（error）與實際完成時間；還原後 UI 就顯示不出大小。
 * 還原當下這些都已知：現行 DB 有同一封存檔的完成紀錄就整組沿用，否則至少用封存檔本身的大小補 file_size。
 * 只動 file_path 檔名與還原中的封存檔相同、且 file_size 仍為 NULL 的列（備份檔名含時間戳，不會撞名）。
 */
export function fillRestoredBackupRow(pendingPath: string, archivePath: string, liveDbPath: string): void {
  const name = path.basename(archivePath)
  const snap = new Database(pendingPath, { fileMustExist: true })
  try {
    const rows = (snap.prepare('SELECT id, file_path FROM backup_logs WHERE file_size IS NULL AND file_path IS NOT NULL').all() as
      { id: number; file_path: string }[]).filter((r) => path.basename(r.file_path) === name)
    if (rows.length === 0) return
    for (const row of rows) {
      const known = liveBackupRow(liveDbPath, [row.file_path, path.resolve(archivePath)])
      if (known) {
        snap.prepare('UPDATE backup_logs SET file_size = ?, extra_file_paths = ?, error = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?')
          .run(known.file_size, known.extra_file_paths, known.error, known.completed_at, row.id)
      } else {
        snap.prepare('UPDATE backup_logs SET file_size = ? WHERE id = ?').run(fs.statSync(archivePath).size, row.id)
      }
    }
    // 快照本來就是 DELETE 模式；保險起見再設一次，確保待還原檔是單一自足檔案、不留 -wal
    snap.pragma('journal_mode = DELETE')
  } finally {
    snap.close()
  }
}

type LiveBackupRow = { file_size: number; extra_file_paths: string | null; error: string | null; completed_at: number | null }

function liveBackupRow(liveDbPath: string, filePaths: string[]): LiveBackupRow | null {
  let live: Database.Database | undefined
  try {
    live = new Database(liveDbPath, { readonly: true, fileMustExist: true })
    const stmt = live.prepare(
      "SELECT file_size, extra_file_paths, error, completed_at FROM backup_logs WHERE file_path = ? AND status = 'completed' AND file_size IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    for (const p of filePaths) {
      const r = stmt.get(p) as LiveBackupRow | undefined
      if (r) return r
    }
    return null
  } catch {
    return null
  } finally {
    try { live?.close() } catch { /* ignore */ }
  }
}

/** 第二步（OpenClaw 換好之後）：只做一次 rename，並把 mtime 設為現在（過期計時從此刻開始）。 */
export function commitPendingDbRestore(dbPath: string): void {
  const tmp = `${pendingOf(dbPath)}.tmp`
  const now = new Date()
  fs.utimesSync(tmp, now, now)
  fs.renameSync(tmp, pendingOf(dbPath))
}

/** 清掉準備階段留下的 .tmp（任何失敗路徑都可呼叫，不丟錯）。 */
export function discardPreparedDbRestore(dbPath: string): void {
  try { fs.rmSync(`${pendingOf(dbPath)}.tmp`, { force: true }) } catch { /* ignore */ }
}

/** 連已提交的 pending 一併撤銷（排程重啟失敗時使用）。 */
export function discardPendingDbRestore(dbPath: string): void {
  discardPreparedDbRestore(dbPath)
  try { fs.rmSync(pendingOf(dbPath), { force: true }) } catch { /* ignore */ }
}

/** 把快照放成 <dbPath>.restore-pending，下次行程啟動時由 db.ts 套用。 */
export function stagePendingDbRestore(snapshotPath: string, dbPath: string, archivePath?: string): void {
  preparePendingDbRestore(snapshotPath, dbPath, archivePath)
  try {
    commitPendingDbRestore(dbPath)
  } catch (err) {
    discardPreparedDbRestore(dbPath)
    throw err
  }
}
