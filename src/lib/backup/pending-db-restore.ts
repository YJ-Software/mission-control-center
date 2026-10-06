import fs from 'fs'

type FsLike = Pick<typeof fs, 'existsSync' | 'renameSync'>

const SUFFIXES = ['', '-wal', '-shm']

/**
 * 啟動時套用已排程的資料庫還原。必須在開啟 SQLite 連線之前呼叫；
 * 不得 import db.ts（會造成循環並提早開連線）。
 */
export function applyPendingDbRestore(
  dbPath: string,
  fsImpl: FsLike = fs,
  now: Date = new Date(),
): 'applied' | 'none' {
  const pending = `${dbPath}.restore-pending`
  if (!fsImpl.existsSync(pending)) return 'none'

  const ts = now.toISOString().replace(/[:.]/g, '-')
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
export function applyPendingDbRestoreOnce(dbPath: string): 'applied' | 'none' {
  const g = globalThis as any
  if (g.__mccPendingDbRestoreChecked) return 'none'
  g.__mccPendingDbRestoreChecked = true
  return applyPendingDbRestore(dbPath)
}
