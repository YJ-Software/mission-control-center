import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

/** 以新開的唯讀連線做線上快照（含 WAL 內尚未 checkpoint 的資料）。 */
export async function snapshotMccDb(srcPath: string, destPath: string): Promise<void> {
  const src = new Database(srcPath, { readonly: true })
  try {
    await src.backup(destPath)
  } finally {
    src.close()
  }
}

/** 來源存在才複製，權限 600；回傳是否有複製。 */
export function copyEnvFile(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o600)
  return true
}

/** 把快照放成 <dbPath>.restore-pending，下次行程啟動時由 db.ts 套用。 */
export function stagePendingDbRestore(snapshotPath: string, dbPath: string): void {
  fs.copyFileSync(snapshotPath, `${dbPath}.restore-pending`)
}
