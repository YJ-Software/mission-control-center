/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { backupLogs } from './schema'

export const STALE_PROCESSING_ERROR = '中斷：MCC 重啟時此備份仍在進行，或此紀錄來自備份檔內的資料庫快照'

/** 把殘留的 processing 紀錄標成 failed。只應在行程啟動時（沒有備份在跑）呼叫一次。回傳修正筆數。 */
export function reconcileStaleBackupLogs(handle: BetterSQLite3Database<any>): number {
  const r = handle.update(backupLogs).set({
    status: 'failed',
    completedAt: Math.floor(Date.now() / 1000),
    error: STALE_PROCESSING_ERROR,
  }).where(eq(backupLogs.status, 'processing')).run()
  return r.changes
}
