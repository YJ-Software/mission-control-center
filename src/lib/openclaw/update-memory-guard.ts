import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import zhTW from '../../../messages/zh-TW.json'
import { gatewayUnitCandidates, whichIn } from './node-preflight'
import { fillMessageTemplate } from './node-preflight-message'
import { memoryBlockMessageValues, type MemoryPreflightBlockDetails } from './memory-preflight-message'

/**
 * 從 MCC 升級 OpenClaw 時的記憶體保護。
 *
 * `openclaw update --yes` 即使已是最新版也會整包重裝（npm install）、重裝外掛、驗證、跑 doctor，
 * 本身就要吃掉 1.5–2 GB 記憶體；gateway 平常又佔 1.2 GB 以上。客戶機多半是 4 GB 沒有 swap，
 * 2026-10-28 throwaway 實測兩者疊在一起把 MemAvailable 壓到 37 MB，主機 thrash 到 SSH 與儀表板
 * 都失去回應、只能從主機商面板重開機（OOM killer 沒出手：沒有 swap 時是 page cache 被擠光）。
 *
 * 所以升級前先停掉 gateway、`openclaw update` 帶 `--no-restart`（換版時 updater 會在自己還佔著記憶體時就把
 * gateway 拉起來驗證），gateway 一律由收尾 phase 在 updater 結束後啟動。再估計
 * 停掉之後的可用記憶體（MemAvailable + SwapFree + gateway 的匿名記憶體）；低於門檻就擋，
 * 使用者看過說明仍可帶 force 照跑。/proc 讀不到時只警告不擋。
 */

/**
 * 升級需要的可用記憶體門檻（MB）。2026-10-28 throwaway（2 vCPU／4 GB、無 swap、gateway 已停）實測 `openclaw update --yes`：
 * - 同版重裝（10.7 → 10.7）：MemAvailable 從 2684 MB 最低降到 1092 MB（降 1555 MB）
 * - 換版（10.7 → 10.8）：從 2580 MB 降到 507 MB（**降 2073 MB**），updater 行程樹匿名記憶體峰值約 2.1 GB，
 *   出現在最後的 doctor（update-migrated-finalize worker 約 1.15 GB + openclaw CLI 約 0.8–0.9 GB）
 * 取換版的 2073 MB，再留約 430 MB 給系統本身（沒有 swap 時可用記憶體低於數百 MB 就開始擠掉程式碼頁、thrash）→ 2500 MB。
 */
export const OPENCLAW_UPDATE_REQUIRED_MB = 2500

export interface Meminfo {
  memAvailableKb: number
  swapFreeKb: number
}

/** `/proc/meminfo` → MemAvailable／SwapFree（kB）；沒有 MemAvailable 回 null（SwapFree 缺就當 0） */
export function parseMeminfo(text: string): Meminfo | null {
  const field = (name: string) => {
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }
  const memAvailableKb = field('MemAvailable')
  if (memAvailableKb === null) return null
  return { memAvailableKb, swapFreeKb: field('SwapFree') ?? 0 }
}

/** `/proc/<pid>/status` 的匿名記憶體（RssAnon + RssShmem，kB）：行程結束後真的會還給系統的部分 */
export function parseStatusAnonKb(text: string): number | null {
  const field = (name: string) => {
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }
  const anon = field('RssAnon')
  if (anon === null) return null
  return anon + (field('RssShmem') ?? 0)
}

/** `systemctl show -p A -p B` 的 `Key=Value` 行 → 物件 */
export function parseSystemctlShow(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export interface GatewayService {
  /** systemd user unit 名稱（不含 .service） */
  unit: string
  /** active／activating／reloading：升級前要停、升級後要啟動回來 */
  running: boolean
  /** 停掉後會還給系統的記憶體（unit cgroup 內各行程的匿名記憶體總和，kB）；讀不到為 null */
  anonKb: number | null
}

export type MemoryPreflight =
  | { verdict: 'ok'; estimateMb: number | null; warnings: string[] }
  | { verdict: 'warn'; estimateMb: number | null; warnings: string[] }
  | { verdict: 'block'; message: string; details: MemoryPreflightBlockDetails; warnings: string[] }

const mb = (kb: number) => Math.round(kb / 1024)

function blockMessage(details: MemoryPreflightBlockDetails): string {
  return fillMessageTemplate(zhTW.openclawMemoryPreflight.blocked, memoryBlockMessageValues(details))
}

/**
 * 預檢判斷（純函式）。估計值 = MemAvailable + SwapFree + 升級前會停掉的 gateway 匿名記憶體；
 * 低於門檻擋下。/proc/meminfo 讀不到 → 只警告。gateway 在跑但讀不到它的記憶體 → 估計值偏低，
 * 只在估計值不足時警告、不擋，避免誤擋。
 */
export function decideMemoryPreflight(input: {
  meminfo: Meminfo | null
  gateway: GatewayService | null
  requiredMb?: number
}): MemoryPreflight {
  const requiredMb = input.requiredMb ?? OPENCLAW_UPDATE_REQUIRED_MB
  const { meminfo, gateway } = input
  const warnings: string[] = []
  if (!gateway) {
    warnings.push('找不到 OpenClaw gateway 的 systemd user unit（openclaw-gateway／openclaw），升級前不會先停止 gateway')
  }
  if (!meminfo) {
    warnings.push('記憶體預檢略過：讀不到 /proc/meminfo，無法確認主機記憶體是否足夠升級 OpenClaw')
    return { verdict: 'warn', estimateMb: null, warnings }
  }
  const gatewayKb = gateway?.running ? gateway.anonKb : 0
  const estimateKb = meminfo.memAvailableKb + meminfo.swapFreeKb + (gatewayKb ?? 0)
  const estimateMb = mb(estimateKb)
  if (estimateMb >= requiredMb) {
    return { verdict: warnings.length ? 'warn' : 'ok', estimateMb, warnings }
  }
  if (gatewayKb === null) {
    warnings.push(
      `記憶體預檢無法確定：讀不到 gateway 佔用的記憶體；不計 gateway 時估計只有約 ${estimateMb} MB 可用，` +
      `升級約需 ${requiredMb} MB，記憶體耗盡時主機可能失去回應`,
    )
    return { verdict: 'warn', estimateMb, warnings }
  }
  const details: MemoryPreflightBlockDetails = {
    estimateMb,
    requiredMb,
    memAvailableMb: mb(meminfo.memAvailableKb),
    swapFreeMb: mb(meminfo.swapFreeKb),
    gatewayMb: mb(gatewayKb),
  }
  return { verdict: 'block', message: blockMessage(details), details, warnings }
}

// ---------------------------------------------------------------------------
// 偵測與 gateway 控制（I/O）
// ---------------------------------------------------------------------------

function run(file: string, args: string[], timeout: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(file, args, { timeout }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err ? err.message : '') })
    })
  })
}

/** gateway 的 user unit 名稱：照 OpenClaw 的候選順序取第一個有 unit 檔的（與 Node 預檢同一份候選） */
export function resolveGatewayUnitName(candidates: string[] = gatewayUnitCandidates()): string | null {
  const found = candidates.find(p => existsSync(p))
  return found ? path.basename(found, '.service') : null
}

function readText(p: string): string | null {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

/** unit cgroup 內所有行程的匿名記憶體總和（kB）；cgroup 讀不到時只算 MainPID；都讀不到回 null */
export function readGatewayAnonKb(
  show: { ControlGroup?: string; MainPID?: string },
  read: (p: string) => string | null = readText,
): number | null {
  const procs = show.ControlGroup ? read(path.join('/sys/fs/cgroup', show.ControlGroup, 'cgroup.procs')) : null
  const pids = procs !== null
    ? procs.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s))
    : show.MainPID && show.MainPID !== '0' ? [show.MainPID] : []
  let total: number | null = null
  for (const pid of pids) {
    const status = read(`/proc/${pid}/status`)
    const anon = status ? parseStatusAnonKb(status) : null
    if (anon !== null) total = (total ?? 0) + anon
  }
  return total
}

const RUNNING_STATES = new Set(['active', 'activating', 'reloading'])

/** gateway user unit 的狀態與佔用；沒有 unit 或 systemctl 不能用回 null */
export async function inspectGatewayService(unit: string | null = resolveGatewayUnitName()): Promise<GatewayService | null> {
  if (!unit) return null
  const r = await run('systemctl', ['--user', 'show', `${unit}.service`, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'ControlGroup'], 10_000)
  if (r.code !== 0) return null
  const show = parseSystemctlShow(r.stdout)
  if (show.LoadState !== 'loaded') return null
  const running = RUNNING_STATES.has(show.ActiveState ?? '')
  return { unit, running, anonKb: running ? readGatewayAnonKb(show) : 0 }
}

export async function runOpenclawMemoryPreflight(deps: {
  readMeminfo: () => Promise<string | null> | string | null
  inspectGateway: () => Promise<GatewayService | null>
  requiredMb?: number
}): Promise<{ preflight: MemoryPreflight; gateway: GatewayService | null }> {
  const [meminfoText, gateway] = await Promise.all([
    Promise.resolve().then(deps.readMeminfo).catch(() => null),
    deps.inspectGateway().catch(() => null),
  ])
  const meminfo = meminfoText ? parseMeminfo(meminfoText) : null
  return { preflight: decideMemoryPreflight({ meminfo, gateway, requiredMb: deps.requiredMb }), gateway }
}

export const readProcMeminfo = (): string | null => readText('/proc/meminfo')

type PhaseLog = (stream: 'stdout' | 'stderr' | 'system', text: string) => void

/** 寫一行目前可用記憶體到 job log（讀不到就不寫） */
function logMemAvailable(log: PhaseLog, prefix: string) {
  const info = parseMeminfo(readProcMeminfo() ?? '')
  if (info) log('system', `${prefix}MemAvailable ${mb(info.memAvailableKb)} MB, SwapFree ${mb(info.swapFreeKb)} MB`)
}

/**
 * 升級前停 gateway 的 phase。gateway 收尾可能很久（unit TimeoutStopSec 預設 90 s，OpenClaw 自己的 unit
 * 是 5 分 30 秒，之後 systemd 會 SIGKILL），時限放寬到 7 分鐘。停不掉 → phase 失敗、不升級，收尾 phase 照跑。
 */
export function stopGatewayPhase(unit: string) {
  return {
    name: `stop ${unit} (free memory for the update)`,
    inline: async (log: PhaseLog) => {
      logMemAvailable(log, 'before stop: ')
      log('system', `systemctl --user stop ${unit}.service — gateway is offline during the update and is started again afterwards`)
      const r = await run('systemctl', ['--user', 'stop', `${unit}.service`], 7 * 60_000)
      if (r.code !== 0) {
        log('stderr', `stop failed (${r.code}): ${r.stderr.trim().slice(-500)}`)
        return r.code
      }
      logMemAvailable(log, 'after stop: ')
      return 0
    },
  }
}

/**
 * 收尾 phase（alwaysRun）：不論升級成功、失敗或逾時都要讓 gateway 回來。帶 `--no-restart` 時 updater 不論成敗都
 * 不會啟動被外部停掉的 gateway（實測）；但 OpenClaw 自己為了 doctor 停過 gateway 時仍會重啟它，所以先看狀態，
 * 已在跑就不動（不再 restart 一次），否則 `systemctl --user start`（對已在啟動中的 unit 是 no-op）。
 */
export function startGatewayPhase(unit: string) {
  return {
    name: `start ${unit}`,
    alwaysRun: true,
    inline: async (log: PhaseLog) => {
      const state = await run('systemctl', ['--user', 'is-active', `${unit}.service`], 10_000)
      const current = state.stdout.trim()
      if (RUNNING_STATES.has(current)) {
        log('system', `${unit}.service is already ${current} (restarted by the OpenClaw updater); leaving it as is`)
        return 0
      }
      log('system', `${unit}.service is ${current || 'not running'}; starting it`)
      const r = await run('systemctl', ['--user', 'start', `${unit}.service`], 3 * 60_000)
      if (r.code !== 0) {
        log('stderr', `start failed (${r.code}): ${r.stderr.trim().slice(-500)} — run: systemctl --user start ${unit}.service`)
        return r.code
      }
      log('system', `${unit}.service started; MCC reconnects to the gateway automatically`)
      return 0
    },
  }
}

/**
 * updater 留下的暫存目錄（`.openclaw.update-stage-*`，一個約 600 MB）：從 job shell PATH 上的 `openclaw`
 * 找出它所在的全域 node_modules，只列出、不刪（那是 OpenClaw 的檔案，`openclaw update repair` 才是正路）。
 */
export function findLeftoverUpdateStageDirs(pathEnv: string): string[] {
  try {
    const bin = whichIn('openclaw', pathEnv)
    if (!bin) return []
    // ~/.npm-global/bin/openclaw → …/lib/node_modules/openclaw/openclaw.mjs：往上找到 node_modules
    let dir = path.dirname(realpathSync(bin))
    while (path.basename(path.dirname(dir)) !== 'node_modules') {
      const parent = path.dirname(dir)
      if (parent === dir) return []
      dir = parent
    }
    const modules = path.dirname(dir)
    return readdirSync(modules).filter(n => n.startsWith('.openclaw.update-stage-')).map(n => path.join(modules, n))
  } catch {
    return []
  }
}
