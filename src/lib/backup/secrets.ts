import type Database from 'better-sqlite3'

/**
 * 備份目的地機敏資料（FTP 密碼）的遮罩工具。
 *
 * 背景（M7）：舊版 uploadToFtp 把 `--user 帳:密` 放在 curl argv，curl 一失敗，
 * execFile 的 `Command failed: <整條命令列>` 就把密碼寫進 backup_logs.error、job log 與 UI，
 * 並隨下一次備份的 DB 快照上傳。這裡集中處理：錯誤訊息遮罩、API 回傳遮罩、編輯時保留舊密碼、
 * 以及既有 DB 資料的一次性清理。
 */

export const SECRET_MASK = '***'

/** 短於此長度的已知密碼不做全文替換（例如 "1" 會把錯誤訊息裡所有數字換掉）；仍有下方的語法遮罩兜底 */
const MIN_LITERAL_SECRET_LENGTH = 4

// 帳密語法一律要求 `帳:密` 形狀（含冒號），避免誤傷 `systemctl --user restart …`、`journalctl -u <unit>` 這類無害訊息
const PATTERNS: Array<[RegExp, string]> = [
  // URL 內嵌帳密：ftp://帳:密@主機
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, `$1${SECRET_MASK}@`],
  // curl 設定檔語法（雙引號，含跳脫）：user = "帳:密"
  [/(\buser\s*=\s*)"(?:[^"\\]|\\.)*"/gi, `$1${SECRET_MASK}`],
  // --user=帳:密、user=帳:密、user = 帳:密
  [/(\buser\s*=\s*)[^\s:"]*:\S*/gi, `$1${SECRET_MASK}`],
  // --user 帳:密（execFile Command failed 訊息的格式）
  [/(--user\s+)[^\s:]*:\S*/g, `$1${SECRET_MASK}`],
  // -u 帳:密
  [/((?:^|\s)-u\s+)[^\s:]*:\S*/g, `$1${SECRET_MASK}`],
]

/** 把文字中的帳密換成 ***：先替換已知密碼本文（長的先），再遮罩各種帳密語法。冪等。 */
export function redactSecrets(text: string, knownSecrets: Array<string | null | undefined> = []): string {
  let out = text
  const literals = [...new Set(knownSecrets)]
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_LITERAL_SECRET_LENGTH && s !== SECRET_MASK)
    .sort((a, b) => b.length - a.length)
  for (const s of literals) out = out.split(s).join(SECRET_MASK)
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
  return out
}

/** curl 設定檔（`-K -` 從 stdin 讀）的帳密行；雙引號字串內跳脫反斜線、引號與控制字元 */
export function buildCurlAuthConfig(user: string, password: string): string {
  const esc = (v: string) => v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `user = "${esc(user ?? '')}:${esc(password ?? '')}"\n`
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

const hasRealPassword = (cfg: Record<string, unknown> | null): cfg is Record<string, unknown> & { password: string } =>
  !!cfg && typeof cfg.password === 'string' && cfg.password !== ''

/** API 回傳用：config 內的密碼換成遮罩值，另附 hasPassword 讓前端顯示「留空代表不變更」 */
export function toPublicDestination<T extends { config: string }>(row: T): T & { hasPassword: boolean } {
  const cfg = parseConfig(row.config)
  if (!cfg) return { ...row, config: '{}', hasPassword: false }
  if (!hasRealPassword(cfg)) return { ...row, hasPassword: false }
  return { ...row, config: JSON.stringify({ ...cfg, password: SECRET_MASK }), hasPassword: true }
}

/**
 * 寫入用：新 config 的密碼為空字串、遮罩值或未帶時，沿用既有密碼（不是 local 目的地才沿用）。
 * 遮罩值本身永遠不落地。
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
  if (type !== 'local' && hasRealPassword(existing)) {
    result.password = existing.password
  } else if (pw === SECRET_MASK) {
    delete result.password
  }
  return result
}

export const BACKUP_LOG_REDACTION_FLAG = 'backup.logSecretsRedacted.v1'

/**
 * 一次性清理（initDb 呼叫）：既有 backup_logs.error 內的 FTP 帳密換成 ***。
 * 用目前所有目的地的密碼做全文比對，再加語法遮罩（目的地已刪除的舊密碼靠 `--user …` 語法抓）。
 * 完成後記旗標；旗標存在就不再掃描。旗標不在時重跑也只會得到相同結果（遮罩冪等）。
 * 從舊 DB 快照還原時旗標跟著回到「未清理」，下次啟動會再清一次。
 * @returns 實際改動的列數
 */
export function redactStoredBackupLogErrors(sqlite: Database.Database): number {
  const done = sqlite.prepare('SELECT 1 FROM settings WHERE key = ?').get(BACKUP_LOG_REDACTION_FLAG)
  if (done) return 0
  const secrets = (sqlite.prepare('SELECT config FROM backup_destinations').all() as { config: string }[])
    .map(r => parseConfig(r.config))
    .filter(hasRealPassword)
    .map(c => c.password)
  const rows = sqlite.prepare('SELECT id, error FROM backup_logs WHERE error IS NOT NULL').all() as { id: number; error: string }[]
  const update = sqlite.prepare('UPDATE backup_logs SET error = ? WHERE id = ?')
  let changed = 0
  sqlite.transaction(() => {
    for (const r of rows) {
      const red = redactSecrets(r.error, secrets)
      if (red !== r.error) { update.run(red, r.id); changed++ }
    }
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(BACKUP_LOG_REDACTION_FLAG, String(Math.floor(Date.now() / 1000)))
  })()
  return changed
}
