/** dpkg 中斷後的自癒。
 *
 * MCC 重啟（或主機重開、OOM）會把跑到一半的 apt/dpkg 一起殺掉，留下
 * 「dpkg was interrupted, you must manually run 'sudo dpkg --configure -a'」：之後每一次 apt 都會失敗。
 * `dpkg --configure -a` 是冪等的（沒事時一秒內結束），所以每條會跑 apt 的路徑在 apt 之前都先跑一次；
 * 它失敗只記 log、不阻擋後面的 apt（後面的 apt 會給出真正的錯誤）。
 *
 * 偵測用 `dpkg --audit`（非 root 可跑）加 `/var/lib/dpkg/updates/` 是否有待處理的 journal
 * （dpkg 被中斷時留下的就是這些檔；非 root 可讀）。 */

import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { getServerEnv } from '@/lib/server-env'

/** sudo 會清掉環境變數，所以要用 `sudo env KEY=val` 明確帶進去，否則 maintainer script 可能停在互動提問 */
const NONINTERACTIVE_ENV = [
  'DEBIAN_FRONTEND=noninteractive',
  'NEEDRESTART_MODE=a',
  'NEEDRESTART_SUSPEND=1',
  'UCF_FORCE_CONFFOLD=1',
  'APT_LISTCHANGES_FRONTEND=none',
]

/** 給 execFile 用的 sudo 參數（-n：需要密碼時直接失敗，不會卡住） */
export const DPKG_REPAIR_SUDO_ARGS: readonly string[] = [
  '-n', 'env', ...NONINTERACTIVE_ENV, 'dpkg', '--configure', '-a',
]

export const DPKG_REPAIR_LABEL = '修復上次中斷的套件安裝（dpkg --configure -a）'

/** job runner 的 shell phase 用：失敗只印一行，exit 0 讓後面的 apt 照跑 */
export function dpkgRepairShell(): string {
  return `sudo ${DPKG_REPAIR_SUDO_ARGS.join(' ')} 2>&1 ` +
    `|| echo "[dpkg-repair] dpkg --configure -a 失敗（exit $?），繼續執行後續步驟"`
}

/** job runner 的「一鍵修復」用：失敗就是失敗（這一步本身就是工作內容） */
export function dpkgRepairStrictShell(): string {
  return `sudo ${DPKG_REPAIR_SUDO_ARGS.join(' ')} 2>&1`
}

const APT_PROGRAMS = new Set(['apt', 'apt-get', 'dpkg', 'aptitude'])

/** 這個指令會不會動到 dpkg 資料庫：`apt-get …`、`sudo apt-get …`、`sudo env K=V apt …`、`dpkg -r …` */
export function isAptCommand(cmd: string, args: readonly string[]): boolean {
  if (APT_PROGRAMS.has(cmd)) return true
  if (cmd !== 'sudo') return false
  let i = 0
  while (i < args.length && args[i].startsWith('-')) i++ // sudo 自己的旗標
  if (args[i] === 'env') {
    i++
    while (i < args.length && (args[i].includes('=') || args[i].startsWith('-'))) i++
  }
  return i < args.length && APT_PROGRAMS.has(args[i])
}

/** 自己判斷是不是 dpkg --configure -a，避免使用者已經手動放了一步時又重複加一次 */
export function isDpkgRepairCommand(cmd: string, args: readonly string[]): boolean {
  const all = [cmd, ...args]
  const at = all.indexOf('dpkg')
  return at >= 0 && all[at + 1] === '--configure' && all[at + 2] === '-a'
}

export interface ExecResult { code: number; stdout: string; stderr: string }
export type ExecFn = (cmd: string, args: readonly string[], timeoutMs: number) => Promise<ExecResult>

const defaultExec: ExecFn = (cmd, args, timeoutMs) => new Promise((resolve) => {
  execFile(cmd, [...args], { timeout: timeoutMs, env: getServerEnv(), maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    // 非零結束時 err.code 是 exit code；spawn 失敗（例如 ENOENT）時是字串，當成 127
    const raw = (err as { code?: unknown } | null)?.code
    const code = !err ? 0 : typeof raw === 'number' ? raw : 127
    resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err ? err.message : '') })
  })
})

/** 跑一次 `sudo -n dpkg --configure -a`；絕不丟錯。逾時 30 分鐘（maintainer script 可能很久）。 */
export async function runDpkgRepair(exec: ExecFn = defaultExec): Promise<{ ok: boolean; output: string }> {
  try {
    const r = await exec('sudo', DPKG_REPAIR_SUDO_ARGS, 30 * 60_000)
    const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim()
    return { ok: r.code === 0, output }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

/** `dpkg --audit` 的輸出：空白代表沒有問題；有內容就原樣回傳（裁掉頭尾空白） */
export function parseDpkgAudit(raw: string): string | null {
  const s = raw.trim()
  return s.length > 0 ? s : null
}

/** /var/lib/dpkg/updates/ 裡的 journal 檔名是純數字；dpkg 被中斷時會留下這些檔 */
export function pendingDpkgJournals(names: readonly string[]): string[] {
  return names.filter((n) => /^\d+$/.test(n))
}

export interface DpkgHealth {
  /** dpkg 不存在（非 Debian 系）或讀不到：不判斷 */
  supported: boolean
  interrupted: boolean
  /** 給通知內文用 */
  detail: string
}

export interface DpkgCheckDeps {
  exec?: ExecFn
  readUpdatesDir?: () => string[]
}

export async function checkDpkgHealth(deps: DpkgCheckDeps = {}): Promise<DpkgHealth> {
  const exec = deps.exec ?? defaultExec
  const readUpdates = deps.readUpdatesDir ?? (() => readdirSync('/var/lib/dpkg/updates'))

  let journals: string[] = []
  let updatesReadable = false
  try {
    journals = pendingDpkgJournals(readUpdates())
    updatesReadable = true
  } catch { /* 非 Debian 系或沒有權限 */ }

  let audit: string | null = null
  let auditRan = false
  try {
    const r = await exec('dpkg', ['--audit'], 60_000)
    // 新版 dpkg 有問題時 exit 非零，但輸出照樣在 stdout；找不到 dpkg 時是 127 且 stdout 空
    auditRan = r.code === 0 || r.stdout.trim().length > 0
    audit = parseDpkgAudit(r.stdout)
  } catch { /* ignore */ }

  if (!updatesReadable && !auditRan) return { supported: false, interrupted: false, detail: '' }

  const parts: string[] = []
  if (journals.length > 0) parts.push(`/var/lib/dpkg/updates/ 有 ${journals.length} 個未處理的 journal（dpkg 上次被中斷）`)
  if (audit) parts.push(`dpkg --audit：\n${audit.split('\n').slice(0, 20).join('\n')}`)
  return { supported: true, interrupted: parts.length > 0, detail: parts.join('\n\n') }
}
