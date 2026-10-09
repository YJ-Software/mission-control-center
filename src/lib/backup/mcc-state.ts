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
export function preparePendingDbRestore(snapshotPath: string, dbPath: string): void {
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
export function stagePendingDbRestore(snapshotPath: string, dbPath: string): void {
  preparePendingDbRestore(snapshotPath, dbPath)
  try {
    commitPendingDbRestore(dbPath)
  } catch (err) {
    discardPreparedDbRestore(dbPath)
    throw err
  }
}
