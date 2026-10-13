/** dpkg 中斷後的自癒。
 *
 * MCC 重啟（或主機重開、OOM）會把跑到一半的 apt/dpkg 一起殺掉，留下
 * 「dpkg was interrupted, you must manually run 'sudo dpkg --configure -a'」：之後每一次 apt 都會失敗。
 * `dpkg --configure -a` 是冪等的（沒事時一秒內結束），所以每條會跑 apt 的路徑在 apt 之前都先跑一次；
 * 它失敗只記 log、不阻擋後面的 apt（後面的 apt 會給出真正的錯誤）。
 *
 * 偵測用 `dpkg --audit`（非 root 可跑）加 `/var/lib/dpkg/updates/` 是否有待處理的 journal
 * （dpkg 被中斷時留下的就是這些檔；非 root 可讀）。 */

import { spawn } from 'node:child_process'
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

/** dpkg 的 conffile 提問發生在 configure 階段、不看 DEBIAN_FRONTEND：沒有這兩個旗標，被管理者改過的設定檔
 *  （例如 sshd_config）會讓 dpkg 停在提問，stdin 關著就失敗、開著就永遠卡住 */
export const DPKG_CONFFILE_FLAGS: readonly string[] = ['--force-confdef', '--force-confold']
/** apt 透過 -o 把同樣的旗標交給 dpkg */
export const APT_CONFFILE_OPTS: readonly string[] = [
  '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold',
]

/** dpkg --configure -a 本體（不含 sudo/env） */
export const DPKG_REPAIR_ARGS: readonly string[] = ['dpkg', ...DPKG_CONFFILE_FLAGS, '--configure', '-a']

/** 給直接 spawn 用的 sudo 參數（-n：需要密碼時直接失敗，不會卡住） */
export const DPKG_REPAIR_SUDO_ARGS: readonly string[] = [
  '-n', 'env', ...NONINTERACTIVE_ENV, ...DPKG_REPAIR_ARGS,
]

/** `sudo -n env <非互動> <program> <args>` 的 sudo 參數；program 是 apt/apt-get 時一併補上 -y 與 conffile 選項 */
export function sudoNonInteractiveArgs(programArgs: readonly string[]): string[] {
  return ['-n', 'env', ...NONINTERACTIVE_ENV, ...withAptNonInteractive(programArgs[0] ?? '', programArgs.slice(1), true)]
}

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
const APT_FRONTENDS = new Set(['apt', 'apt-get', 'aptitude'])

/** 套件管理程式在 args 裡的位置：cmd 本身是 apt 類時回 -1；找不到回 null */
function aptProgramIndex(cmd: string, args: readonly string[]): number | null {
  if (APT_PROGRAMS.has(cmd)) return -1
  if (cmd !== 'sudo') return null
  let i = 0
  while (i < args.length && args[i].startsWith('-')) i++ // sudo 自己的旗標
  if (args[i] === 'env') {
    i++
    while (i < args.length && (args[i].includes('=') || args[i].startsWith('-'))) i++
  }
  return i < args.length && APT_PROGRAMS.has(args[i]) ? i : null
}

/** 這個指令會不會動到 dpkg 資料庫：`apt-get …`、`sudo apt-get …`、`sudo env K=V apt …`、`dpkg -r …` */
export function isAptCommand(cmd: string, args: readonly string[]): boolean {
  return aptProgramIndex(cmd, args) !== null
}

/**
 * 回傳補齊非互動參數後的 args（不改原陣列）：
 * - apt/apt-get/aptitude：程式名後面補 `-y` 與 `-o Dpkg::Options::=--force-confdef/--force-confold`
 * - dpkg 的 --configure / -i / --install：補 `--force-confdef --force-confold`（-r/--remove 不會問 conffile，不動）
 * 已經有的不重複加。cmdIsProgram：args[0] 之外的 cmd 本身就是程式（給 sudoNonInteractiveArgs 用）。
 */
export function withAptNonInteractive(cmd: string, args: readonly string[], cmdIsProgram = false): string[] {
  const at = cmdIsProgram ? (APT_PROGRAMS.has(cmd) ? -1 : null) : aptProgramIndex(cmd, args)
  const out = cmdIsProgram ? [cmd, ...args] : [...args]
  if (at === null) return out
  const progPos = cmdIsProgram ? 0 : at // 在 out 裡的位置（-1 代表 cmd 本身）
  const program = progPos === -1 ? cmd : out[progPos]
  const rest = out.slice(progPos + 1)
  const add: string[] = []
  if (APT_FRONTENDS.has(program)) {
    if (!rest.includes('-y') && !rest.includes('--yes') && !rest.includes('--assume-yes')) add.push('-y')
    if (!rest.some((a) => a.includes('--force-confold'))) add.push(...APT_CONFFILE_OPTS)
  } else if (program === 'dpkg') {
    const configures = rest.some((a) => a === '--configure' || a === '-i' || a === '--install')
    if (configures && !rest.includes('--force-confold')) add.push(...DPKG_CONFFILE_FLAGS)
  }
  return [...out.slice(0, progPos + 1), ...add, ...rest]
}

/** 自己判斷是不是 dpkg --configure -a（中間可夾 --force-* 旗標），避免已經有一步時又重複加一次 */
export function isDpkgRepairCommand(cmd: string, args: readonly string[]): boolean {
  const all = [cmd, ...args]
  const at = all.indexOf('dpkg')
  if (at < 0) return false
  const rest = all.slice(at + 1).filter((a) => !a.startsWith('--force-'))
  return rest[0] === '--configure' && rest[1] === '-a'
}

export interface ExecResult { code: number; stdout: string; stderr: string }
export type ExecFn = (cmd: string, args: readonly string[], timeoutMs: number) => Promise<ExecResult>

const MAX_OUTPUT = 1024 * 1024

/**
 * 跑一個不可互動的指令並收集輸出；絕不丟錯。stdin 一律 'ignore'：execFile 留著一條開著但沒資料的 pipe，
 * 任何提問都會讓子行程永遠卡住（直到逾時被殺，等於自己製造一次 dpkg 中斷）。spawn 失敗（ENOENT）回 127。
 */
export function runNonInteractive(cmd: string, args: readonly string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (r: ExecResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r) } }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, [...args], { env: getServerEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: 127, stdout: '', stderr: e instanceof Error ? e.message : String(e) })
      return
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      stderr += `\n[timeout after ${Math.round(timeoutMs / 1000)}s]`
      child.kill('SIGTERM')
    }, timeoutMs)
    // 逾時被殺時以 exit 為準：孫行程可能還握著 stdout，等 close 會一直等下去
    child.on('exit', (code, signal) => { if (timedOut) done({ code: code ?? (signal ? 128 : 1), stdout, stderr }) })
    child.stdout?.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString() })
    child.on('error', (e) => done({ code: 127, stdout, stderr: stderr || e.message }))
    child.on('close', (code, signal) => done({ code: code ?? (signal ? 128 : 1), stdout, stderr }))
  })
}

const defaultExec: ExecFn = runNonInteractive

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
