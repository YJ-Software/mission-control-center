import type Database from 'better-sqlite3'

/**
 * 同一行程會載入兩份 db.ts（server.ts 由 tsx 載入、Next bundle 再載一次，HMR 還會重跑），
 * 各自開一條 better-sqlite3 連線。SQLite 只在「最後一條」連線關閉時才 checkpoint WAL 並刪掉
 * -wal/-shm，所以關機時必須把全部連線都關掉。登記表放在 globalThis，兩份模組共用。
 */
const KEY = '__mccDbConnections'

function registry(): Set<Database.Database> {
  const g = globalThis as unknown as Record<string, Set<Database.Database> | undefined>
  return (g[KEY] ??= new Set())
}

export function registerDbConnection(conn: Database.Database): void {
  registry().add(conn)
}

/** 關閉所有已登記的連線；可重複呼叫、絕不丟錯。 */
export function closeDb(): void {
  const set = registry()
  for (const conn of set) {
    try {
      if (conn.open) conn.close()
    } catch (err) {
      console.error('[db] close failed:', err)
    }
  }
  set.clear()
}
