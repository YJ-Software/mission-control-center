import Database from 'better-sqlite3'

/**
 * settings 旗標：舊版 AI agent 備份 cron（「💾 Backup:」）已清理完成，之後的開機不再 list cron。
 * 獨立成檔是因為 pending-db-restore.ts（db.ts 開連線前執行）也要用，不可 import db.ts。
 */
export const LEGACY_CRON_CLEANED_KEY = 'backup.legacyCronCleaned'

/**
 * 直接對 SQLite 檔清掉旗標（套用還原回來的資料庫後、db.ts 開連線前使用）。
 * 還原回來的資料庫帶著「備份當時」的旗標值，與現在 ~/.openclaw 裡有沒有舊 cron 無關，所以一律清掉、讓開機再掃一次。
 * 沒有 settings 表視為沒有旗標。失敗時丟錯，由呼叫端決定如何記錄。
 */
export function clearLegacyCronFlagInFile(file: string): void {
  const conn = new Database(file, { fileMustExist: true })
  try {
    const hasSettings = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()
    if (hasSettings) conn.prepare('DELETE FROM settings WHERE key = ?').run(LEGACY_CRON_CLEANED_KEY)
  } finally {
    conn.close()
  }
}
