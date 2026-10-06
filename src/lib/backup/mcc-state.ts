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

/** 把快照放成 <dbPath>.restore-pending，下次行程啟動時由 db.ts 套用。 */
export function stagePendingDbRestore(snapshotPath: string, dbPath: string): void {
  if (!isSqliteDbHealthy(snapshotPath)) {
    throw new Error(`備份中的資料庫快照無法通過完整性檢查，已拒絕排程還原：${snapshotPath}`)
  }
  const pending = `${dbPath}.restore-pending`
  const tmp = `${pending}.tmp`
  try {
    fs.copyFileSync(snapshotPath, tmp)
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, pending)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}
