import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { readAllJobsSync, jobLogPath } from '@/lib/jobs/store'
import type { JobMeta } from '@/lib/jobs/types'

/**
 * 備份目的地機敏資料（FTP 密碼）的遮罩工具。
 *
 * 背景（M7）：v0.4.0／0.4.1 的 uploadToFtp 把 `--user 帳:密` 放在 curl argv，curl 一失敗，
 * execFile 的 `Command failed: <整條命令列>` 就把密碼寫進 backup_logs.error、backup-run 的 job log 與 UI，
 * 並隨下一次備份的 DB 快照上傳。這裡集中處理：錯誤訊息遮罩、API 回傳遮罩、編輯時保留舊密碼、
 * 以及既有資料（DB 與 job log）的一次性清理。
 */

export const SECRET_MASK = '***'

/** 一組 FTP 帳密（取自 backup_destinations.config）；欄位型別不保證是字串 */
export interface Credential { user?: unknown; password?: unknown }

/** 只在 curl stderr 尾段做「裸密碼」全文替換時使用；短於此長度不替換（"1" 會把所有數字換掉） */
const MIN_LITERAL_SECRET_LENGTH = 4

// 帳密語法一律要求 `帳:密` 形狀（冒號後至少一個字元），避免誤傷
// `systemctl --user restart …`、`journalctl -u openclaw-gateway: no entries`、`user=root: denied` 這類無害訊息
const PATTERNS: Array<[RegExp, string]> = [
  // 舊 curl argv 的固定順序：`--user <帳:密，可能含空白> --ftp-pasv|--connect-timeout`
  [/(--user\s+)[^\n]*?(?=\s--(?:ftp-pasv|connect-timeout)\b)/g, `$1${SECRET_MASK}`],
  // URL 內嵌帳密：ftp://帳:密@主機
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${SECRET_MASK}@`],
  // curl 設定檔語法（雙引號，含跳脫）：user = "帳:密"
  [/(\buser\s*=\s*)"(?:[^"\\]|\\.)*"/gi, `$1${SECRET_MASK}`],
  // --user=帳:密、user=帳:密、user = 帳:密
  [/(\buser\s*=\s*)[^\s:"]*:\S+/gi, `$1${SECRET_MASK}`],
  // --user 帳:密
  [/(--user\s+)[^\s:]*:\S+/g, `$1${SECRET_MASK}`],
  // -u 帳:密
  [/((?:^|\s)-u\s+)[^\s:]*:\S+/g, `$1${SECRET_MASK}`],
]

const isSet = (v: unknown) => v !== undefined && v !== null && v !== ''

/** `帳:密` 字面配對（帳號為空時不做，避免 `:backup` 這種過短片段誤傷），長的先 */
function credentialPairs(creds: Credential[]): string[] {
  const pairs = creds
    .filter(c => isSet(c.password) && isSet(c.user))
    .map(c => `${String(c.user)}:${String(c.password)}`)
  return [...new Set(pairs)].sort((a, b) => b.length - a.length)
}

/**
 * 遮罩帳密：先把已知的 `帳:密` 字面配對換成 ***，再套各種帳密語法。冪等。
 * 不做裸密碼全文替換：常見字密碼（例如 `backup`）會永久改寫路徑等無關文字。
 */
export function redactSecrets(text: string, creds: Credential[] = []): string {
  let out = text
  for (const pair of credentialPairs(creds)) out = out.split(pair).join(SECRET_MASK)
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
  return out
}

/**
 * 只用於「當下這次 curl 的 stderr 尾段」：伺服器可能回顯密碼本身，所以額外做裸密碼全文替換（≥4 字元）。
 * 範圍只有幾百字的當次錯誤，不用在歷史資料清理。
 */
export function redactSecretValues(text: string, creds: Credential[]): string {
  let out = redactSecrets(text, creds)
  const literals = [...new Set(creds.map(c => c.password).filter(isSet).map(String))]
    .filter(s => s.length >= MIN_LITERAL_SECRET_LENGTH && s !== SECRET_MASK)
    .sort((a, b) => b.length - a.length)
  for (const s of literals) out = out.split(s).join(SECRET_MASK)
  return out
}

/** curl 設定檔（`-K -` 從 stdin 讀）的帳密行；雙引號字串內跳脫反斜線、引號與控制字元 */
export function buildCurlAuthConfig(user: unknown, password: unknown): string {
  const esc = (v: unknown) => String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `user = "${esc(user)}:${esc(password)}"\n`
}

function parseConfig(json: string | null | undefined): Record<string, unknown> | null {
  if (typeof json !== 'string') return null
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** 任何非空值（字串、數字、物件…）都算「有密碼」，一律不可外送 */
const hasPassword = (cfg: Record<string, unknown> | null): cfg is Record<string, unknown> =>
  !!cfg && isSet(cfg.password)

/** API 回傳用：config 內的密碼換成遮罩值，另附 hasPassword 讓前端顯示「留空代表不變更」 */
export function toPublicDestination<T extends { config: string }>(row: T): T & { hasPassword: boolean } {
  const cfg = parseConfig(row.config)
  if (!cfg) return { ...row, config: '{}', hasPassword: false }
  if (!hasPassword(cfg)) return { ...row, hasPassword: false }
  return { ...row, config: JSON.stringify({ ...cfg, password: SECRET_MASK }), hasPassword: true }
}

/** 留空沿用舊密碼，但主機／連接埠／帳號改了：舊密碼不該被送到新的對象 */
export class PasswordRequiredError extends Error {
  constructor() {
    super('Password required when changing host, port or user')
    this.name = 'PasswordRequiredError'
  }
}

const CREDENTIAL_TARGET_KEYS = ['ip', 'port', 'user'] as const

/**
 * 寫入用：新 config 的密碼為空字串、遮罩值或未帶時，沿用既有密碼（不是 local 目的地才沿用）。
 * 若同時改了 ip／port／user，丟 PasswordRequiredError（要求重新輸入）。遮罩值本身永遠不落地。
 */
export function mergeDestinationConfig(
  existingJson: string | null | undefined,
  incoming: Record<string, unknown>,
  type?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...incoming }
  const pw = incoming.password
  const keepExisting = pw === undefined || pw === '' || pw === SECRET_MASK
  if (!keepExisting) return result
  const existing = parseConfig(existingJson)
  if (type !== 'local' && hasPassword(existing)) {
    const changed = CREDENTIAL_TARGET_KEYS.some(k =>
      k in incoming && String(incoming[k] ?? '') !== String(existing[k] ?? ''))
    if (changed) throw new PasswordRequiredError()
    result.password = existing.password
  } else if (pw === SECRET_MASK) {
    delete result.password
  }
  return result
}

// ---------------------------------------------------------------------------
// 既有資料的一次性清理（initDb 呼叫）
// ---------------------------------------------------------------------------

/** v2：v1 只清 DB；v2 起連 backup-run 的 job log 一起清 */
export const BACKUP_SECRETS_CLEANUP_FLAG = 'backup.secretsRedacted.v2'

/** 目前所有目的地的帳密（壞掉的 config、沒有密碼的略過） */
export function collectDestinationCredentials(sqlite: Database.Database): Credential[] {
  return (sqlite.prepare('SELECT config FROM backup_destinations').all() as { config: string }[])
    .map(r => parseConfig(r.config))
    .filter(hasPassword)
    .map(c => ({ user: c.user, password: c.password }))
}

/** backup_logs.error 內的帳密換成 ***；回傳實際改動的列數。冪等。 */
export function redactStoredBackupLogErrors(sqlite: Database.Database, creds: Credential[]): number {
  const rows = sqlite.prepare('SELECT id, error FROM backup_logs WHERE error IS NOT NULL').all() as { id: number; error: string }[]
  const update = sqlite.prepare('UPDATE backup_logs SET error = ? WHERE id = ?')
  let changed = 0
  sqlite.transaction(() => {
    for (const r of rows) {
      const red = redactSecrets(r.error, creds)
      if (red !== r.error) { update.run(red, r.id); changed++ }
    }
  })()
  return changed
}

export interface JobLogDeps {
  listJobs: () => Pick<JobMeta, 'id' | 'kind'>[]
  logPath: (id: string) => string
}
const defaultJobLogDeps: JobLogDeps = { listJobs: readAllJobsSync, logPath: jobLogPath }

function redactJobLogLine(line: string, creds: Credential[]): string {
  if (!line.trim()) return line
  try {
    const obj = JSON.parse(line) as { text?: unknown }
    if (typeof obj.text !== 'string') return line
    const red = redactSecrets(obj.text, creds)
    return red === obj.text ? line : JSON.stringify({ ...obj, text: red })
  } catch {
    return redactSecrets(line, creds)
  }
}

/**
 * backup-run 類型 job 的 log 檔（JSON lines）內的帳密換成 ***。
 * 有命中才改寫，且先寫同目錄暫存檔再 rename（不會半寫）；單一檔案失敗只計數，不中斷其他檔。
 */
export function redactBackupJobLogs(
  creds: Credential[],
  deps: JobLogDeps = defaultJobLogDeps,
): { changed: number; failed: number } {
  let changed = 0
  let failed = 0
  for (const meta of deps.listJobs()) {
    if (meta.kind !== 'backup-run') continue
    const p = deps.logPath(meta.id)
    let tmp: string | null = null
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf8')
      const out = raw.split('\n').map(l => redactJobLogLine(l, creds)).join('\n')
      if (out === raw) continue
      tmp = `${p}.redact-${process.pid}.tmp`
      fs.writeFileSync(tmp, out, { mode: fs.statSync(p).mode & 0o777 })
      fs.renameSync(tmp, p)
      tmp = null
      changed++
    } catch {
      failed++
      if (tmp) { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }
    }
  }
  return { changed, failed }
}

/**
 * 啟動時的一次性清理：DB 的 backup_logs.error ＋ backup-run job log。
 * 旗標存在就跳過；job log 全部成功才記旗標（DB 遮罩冪等，失敗時下次啟動重跑無害）。
 * 任何錯誤只記 log，絕不丟出（不可擋住啟動）。
 */
export function runBackupSecretsCleanup(
  sqlite: Database.Database,
  opts: { jobLogs?: JobLogDeps; log?: Pick<Console, 'log' | 'warn'> } = {},
): void {
  const log = opts.log ?? console
  try {
    if (sqlite.prepare('SELECT 1 FROM settings WHERE key = ?').get(BACKUP_SECRETS_CLEANUP_FLAG)) return
    const creds = collectDestinationCredentials(sqlite)
    const dbRows = redactStoredBackupLogErrors(sqlite, creds)
    let jobLogs = { changed: 0, failed: 0 }
    try {
      jobLogs = redactBackupJobLogs(creds, opts.jobLogs)
    } catch (err) {
      jobLogs.failed++
      log.warn('[Backup] 讀取 job 清單失敗，略過 job log 帳密遮罩：', (err as Error).message)
    }
    if (dbRows > 0 || jobLogs.changed > 0) {
      log.log(`[Backup] 已遮罩 FTP 帳密：備份紀錄 ${dbRows} 筆、job log ${jobLogs.changed} 個`)
    }
    if (jobLogs.failed > 0) {
      log.warn(`[Backup] ${jobLogs.failed} 個 job log 無法遮罩 FTP 帳密，下次啟動會重試`)
      return
    }
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(BACKUP_SECRETS_CLEANUP_FLAG, String(Math.floor(Date.now() / 1000)))
  } catch (err) {
    log.warn('[Backup] 遮罩既有資料中的 FTP 帳密失敗：', (err as Error).message)
  }
}
