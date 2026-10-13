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

export interface ApplyReport {
  detail?: string
  /** 本次搬走舊庫用的複本主檔名（db.sqlite.pre-restore-<ts>）；丟錯時供自救優先使用 */
  preRestoreBase?: string
  /** 丟錯後回滾失敗的 rename（「來源 → 目的：原因」） */
  rollbackFailures?: string[]
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 注意：同一行程會載入兩份 db.ts（server.ts 由 tsx 載入、Next bundle 的 route 再載一次，HMR 還會重跑），
 * 只套用一次靠的是 applyPendingDbRestoreOnce 的 globalThis guard，不是只有一處 import。
 * 若日後有「另一個行程」的獨立腳本 import db.ts，guard 擋不到，它會在 server 執行中
 * 套用待還原檔，把 db 在連線底下換掉。
 *
 * 啟動時套用已排程的資料庫還原。必須在開啟 SQLite 連線之前呼叫；
 * 不得 import db.ts（會造成循環並提早開連線）。
 */
export function applyPendingDbRestore(
  dbPath: string,
  fsImpl: FsLike = fs,
  now: Date = new Date(),
  report?: ApplyReport,
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
  if (report) report.preRestoreBase = `${dbPath}.pre-restore-${ts}`
  try {
    for (const suf of SUFFIXES) {
      const from = `${dbPath}${suf}`
      if (!fsImpl.existsSync(from)) continue
      // 後綴放在標記之後（db.sqlite.pre-restore-<ts>-wal）：SQLite 只靠「<主檔>-wal」命名配對日誌，
      // 否則未 checkpoint 的資料留在改名後的 wal 裡，複本打開是空的
      const to = `${dbPath}.pre-restore-${ts}${suf}`
      fsImpl.renameSync(from, to)
      moved.push([from, to])
    }
    fsImpl.renameSync(pending, dbPath)
  } catch (err) {
    for (const [from, to] of moved.reverse()) {
      try {
        fsImpl.renameSync(to, from)
      } catch (e) {
        // 不可默默吞掉：回滾失敗時 db.sqlite 可能已不存在，applyPendingDbRestoreOnce 要據此自救並說明
        if (report) (report.rollbackFailures ??= []).push(`${to} → ${from}：${errMsg(e)}`)
      }
    }
    throw err
  }
  if (report) report.detail = `已套用待還原的資料庫；舊資料庫保留為 ${dbPath}.pre-restore-${ts}`
  return 'applied'
}

const PRE_RESTORE_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

/** 找最新的 <db>.pre-restore-<ts> 主檔（不含 -wal/-shm）；時戳是 ISO 格式，字串排序即時間排序 */
export function findLatestPreRestore(dbPath: string): string | null {
  try {
    const prefix = `${path.basename(dbPath)}.pre-restore-`
    const names = fs.readdirSync(path.dirname(dbPath))
      .filter((n) => n.startsWith(prefix) && PRE_RESTORE_TS_RE.test(n.slice(prefix.length)))
      .sort()
    return names.length ? path.join(path.dirname(dbPath), names[names.length - 1]) : null
  } catch { return null }
}

/**
 * 套用失敗後的自救：回滾沒做完時，把 pre-restore 複本搬回 dbPath，避免 db.ts 開連線時建出空庫。
 * 優先用本次搬走的那一組；本次沒搬任何檔、但 dbPath 不存在時，才用最新的一組。
 * 主檔先搬，主檔就位後才搬 -wal/-shm（日誌不可先於主檔出現，也不覆寫既有檔）。絕不丟錯。
 * 回傳給 detail 用的說明；什麼都不用做時回傳 null。
 */
function rescueAfterFailedApply(dbPath: string, fsImpl: FsLike, report: ApplyReport): string | null {
  try {
    const exists = (p: string) => { try { return fsImpl.existsSync(p) } catch { return false } }
    const ownLeft = report.preRestoreBase && SUFFIXES.some((suf) => exists(`${report.preRestoreBase}${suf}`))
      ? report.preRestoreBase
      : null
    const dbMissing = !exists(dbPath)
    if (!ownLeft && !dbMissing) return null
    const src = ownLeft ?? findLatestPreRestore(dbPath)
    if (!src) {
      return `目前資料庫檔不存在，也找不到 pre-restore 複本，MCC 將以空資料庫啟動`
    }
    const failures: string[] = []
    if (exists(src)) {
      if (exists(dbPath)) {
        failures.push(`${dbPath} 已存在，未覆寫；${src} 留在原處`)
      } else {
        try {
          fsImpl.renameSync(src, dbPath)
        } catch (e) {
          failures.push(`${src} → ${dbPath}：${errMsg(e)}`)
        }
      }
    }
    if (!exists(dbPath)) {
      return `目前資料庫檔不存在，MCC 將以空資料庫啟動；你的資料仍在 ${src}（連同同名的 -wal/-shm），` +
        `請手動搬回 ${dbPath}（先停止 MCC，-wal/-shm 一併改名）後重啟` +
        (failures.length ? `（自動搬回失敗：${failures.join('；')}）` : '')
    }
    for (const suf of ['-wal', '-shm']) {
      const from = `${src}${suf}`
      const to = `${dbPath}${suf}`
      if (!exists(from)) continue
      if (exists(to)) { failures.push(`${to} 已存在，未覆寫；${from} 留在原處`); continue }
      try {
        fsImpl.renameSync(from, to)
      } catch (e) {
        failures.push(`${from} → ${to}：${errMsg(e)}`)
      }
    }
    const moved = `已自動把 ${src} 搬回 ${dbPath}，繼續使用原資料庫開機`
    return failures.length
      ? `${moved}；但下列檔案未能搬回，最近的資料可能不在現行資料庫中，請停止 MCC 後手動改名再重啟：${failures.join('；')}`
      : moved
  } catch (e) {
    return `檢查資料庫檔時發生錯誤（${errMsg(e)}）；若 MCC 開機後資料是空的，請到 ${path.dirname(dbPath)} 找 ${path.basename(dbPath)}.pre-restore-* 手動搬回`
  }
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

/**
 * 每個行程只檢查一次（server.ts 與 Next bundle 各會載入 db.ts，HMR 也會重跑）。
 * 絕不丟錯：db.ts 在模組載入時呼叫，丟錯會讓 MCC 開機失敗、被 systemd 每 3 秒重啟、
 * 而 pending 檔還在，每次都再失敗（crash-loop）。意外錯誤時把 pending 移到
 * .restore-rejected-<ts>、記錄 error，繼續以現行資料庫開機。
 */
export function applyPendingDbRestoreOnce(
  dbPath: string,
  fsImpl: FsLike = fs,
  now: Date = new Date(),
): 'applied' | 'none' | 'rejected' | 'error' {
  const g = globalThis as any
  if (g.__mccPendingDbRestoreChecked) return 'none'
  g.__mccPendingDbRestoreChecked = true
  const report: ApplyReport = {}
  try {
    const r = applyPendingDbRestore(dbPath, fsImpl, now, report)
    if (r !== 'none') writeLastDbRestore(dbPath, r, report.detail ?? '')
    return r
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const pending = `${dbPath}.restore-pending`
    let aside: string
    try {
      if (fsImpl.existsSync(pending)) {
        const rejected = `${dbPath}.restore-rejected-${now.toISOString().replace(/[:.]/g, '-')}`
        fsImpl.renameSync(pending, rejected)
        aside = `待還原檔已移至 ${rejected}`
      } else {
        aside = '待還原檔已不存在'
      }
    } catch (e) {
      aside = `待還原檔也無法移開（${e instanceof Error ? e.message : String(e)}），仍在 ${pending}`
    }
    const rescue = rescueAfterFailedApply(dbPath, fsImpl, report)
    const rollback = report.rollbackFailures?.length ? `；回滾時未能移回的檔案：${report.rollbackFailures.join('；')}` : ''
    const detail = `套用待還原資料庫時發生錯誤：${reason}；${rescue ?? '繼續使用現行資料庫開機'}；${aside}${rollback}`
    try { console.error(`[Backup] ${detail}`) } catch { /* ignore */ }
    writeLastDbRestore(dbPath, 'error', detail, now)
    return 'error'
  }
}

/** 讀取開機還原結果；檔案不存在或內容壞掉一律回 null。 */
export function readLastDbRestore(
  dbPath: string,
): { result: 'applied' | 'rejected' | 'error'; at: string; detail: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(dbPath), 'last-db-restore.json'), 'utf8'))
    if (!raw || typeof raw !== 'object') return null
    if (!['applied', 'rejected', 'error'].includes(raw.result)) return null
    if (typeof raw.at !== 'string') return null
    return { result: raw.result, at: raw.at, detail: typeof raw.detail === 'string' ? raw.detail : '' }
  } catch { return null }
}
