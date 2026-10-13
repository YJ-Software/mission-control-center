// 本行程內「不可中斷的長時間子行程」登記表：apt/dpkg/docker/npm/uv/ollama 這類安裝作業。
//
// MCC 的 systemd unit 是 KillMode=control-group：重啟 MCC 會連同 cgroup 內所有子行程一起送 SIGTERM，
// sudo → apt-get → dpkg 會被當場中斷，留下 `dpkg was interrupted`。MCC 自己發起的重啟（升級、重啟儀表板、
// 還原、重開機）在登記表非空時一律拒絕（409），把這類中斷擋在 MCC 自己能管的範圍內。外部的 systemctl 不在範圍。
//
// 放在 globalThis：server.ts bundle 與 Next bundle 在同一個行程、各自載入本模組（dev HMR 也會重載），
// 必須共用同一份紀錄（同 backup/lock.ts、jobs/live.ts 的做法）。

import type { JobKind } from '@/lib/jobs/types'

export interface LongRunEntry {
  id: number
  /** 給操作者看的名稱，例如「Obsidian 安裝」 */
  name: string
  /** ISO 時間 */
  startedAt: string
  /** 目前在跑的子行程 PID；還沒 spawn 或在兩步之間時為 null */
  pid: number | null
  /** 目前步驟（例如「Installing Obsidian」） */
  step?: string
  /** job runner 登記的 job 種類（SSE／execFile 安裝沒有） */
  kind?: string
}

const KEY = '__mccLongRuns'
const SEQ_KEY = '__mccLongRunSeq'
const PENDING_KEY = '__mccRestartPendingUntil'
const PROBE_KEY = '__mccLongRunPidProbe'
const store = globalThis as unknown as Record<string, unknown>

function runs(): Map<number, LongRunEntry> {
  return ((store[KEY] as Map<number, LongRunEntry> | undefined) ??= new Map<number, LongRunEntry>()) as Map<number, LongRunEntry>
}

/** job runner 裡會跑 apt/npm/uv 的 job 種類：整個 job 期間都登記為長時間作業 */
export const LONG_RUNNING_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  'sys-update', 'dpkg-repair', 'upgrade-openclaw', 'upgrade-opencli', 'upgrade-nlm',
])

/** MCC 即將重啟（重啟已排程）時開始新的安裝：會在幾秒內被一起殺掉，所以直接拒絕 */
export class RestartPendingError extends Error {
  constructor() { super('MCC 即將重啟，暫時無法開始安裝；請等重啟完成後再試') }
}

/** 重啟排程前呼叫。ttl 過後自動失效（重啟沒有真的發生、行程還活著時不會永遠擋住安裝） */
export function markRestartPending(ttlMs = 120_000): void {
  store[PENDING_KEY] = Date.now() + ttlMs
}

export function clearRestartPending(): void {
  store[PENDING_KEY] = null
}

export function isRestartPending(): boolean {
  const until = store[PENDING_KEY] as number | null | undefined
  return typeof until === 'number' && Date.now() < until
}

export function registerLongRun(name: string, opts: { pid?: number | null; step?: string; kind?: string } = {}): number {
  if (isRestartPending()) throw new RestartPendingError()
  const id = ((store[SEQ_KEY] as number | undefined) ?? 0) + 1
  store[SEQ_KEY] = id
  runs().set(id, { id, name, startedAt: new Date().toISOString(), pid: opts.pid ?? null, step: opts.step, kind: opts.kind })
  return id
}

/** PID 是否還活著。EPERM（例如 root 擁有的 sudo）代表活著；只有 ESRCH 代表不存在 */
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function pidAlive(pid: number): boolean {
  const probe = store[PROBE_KEY] as ((pid: number) => boolean) | undefined
  return (probe ?? defaultPidAlive)(pid)
}

/**
 * 登記項的 PID 已經不存在卻還掛著時，當場註銷並記 log，不讓一筆殘留永遠擋住重啟。
 * 呼叫端在子行程 exit 時就把 PID 清成 null，所以「PID 非 null 且 ESRCH」只會是真正的殘留，
 * 不會是 exit 了但 close 還沒觸發、後面還有步驟的串流。沒有 PID 的登記項無從判斷，保留。
 */
export function pruneDeadLongRuns(): LongRunEntry[] {
  const removed: LongRunEntry[] = []
  for (const [id, e] of runs()) {
    if (e.pid !== null && !pidAlive(e.pid)) {
      runs().delete(id)
      removed.push({ ...e })
      console.warn(`[long-run] 「${e.name}」的 PID ${e.pid} 已不存在，自動註銷`)
    }
  }
  return removed
}

export function updateLongRun(id: number, patch: { pid?: number | null; step?: string }): void {
  const e = runs().get(id)
  if (!e) return
  if (patch.pid !== undefined) e.pid = patch.pid
  if (patch.step !== undefined) e.step = patch.step
}

/** 回傳是否真的註銷（重複註銷無害） */
export function unregisterLongRun(id: number): boolean {
  return runs().delete(id)
}

/** 依開始時間排序的快照（複本，呼叫端改了不影響登記表）；先註銷 PID 已死的登記項 */
export function listLongRuns(): LongRunEntry[] {
  pruneDeadLongRuns()
  return [...runs().values()].map((e) => ({ ...e })).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id - b.id)
}

export function hasLongRuns(): boolean {
  pruneDeadLongRuns()
  return runs().size > 0
}

export interface LongRunHandle {
  id: number
  setPid: (pid: number | null | undefined) => void
  setStep: (step: string) => void
}

/** 整段 fn 期間登記為長時間作業；不論成功或丟錯都會註銷 */
export async function withLongRun<T>(name: string, fn: (h: LongRunHandle) => Promise<T>): Promise<T> {
  const id = registerLongRun(name)
  const h: LongRunHandle = {
    id,
    setPid: (pid) => updateLongRun(id, { pid: pid ?? null }),
    setStep: (step) => updateLongRun(id, { step }),
  }
  try {
    return await fn(h)
  } finally {
    unregisterLongRun(id)
  }
}

/** 同步版本（execSync 一類的路徑用） */
export function withLongRunSync<T>(name: string, fn: () => T): T {
  const id = registerLongRun(name)
  try {
    return fn()
  } finally {
    unregisterLongRun(id)
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function describeLongRuns(list: LongRunEntry[]): string {
  return list.map((r) => `「${r.name}」（${fmtTime(r.startedAt)} 開始，${r.pid !== null ? `PID ${r.pid}` : '無 PID'}）`).join('、')
}

export function longRunBusyMessage(list: LongRunEntry[]): string {
  return `${describeLongRuns(list)}進行中，現在重啟會中斷它，可能讓系統套件停在安裝一半的狀態；請等它完成後再試`
}

/** 使用者帶 force 強制重啟時寫進 job log 與伺服器 log 的一行 */
export function forcedRestartNote(list: LongRunEntry[]): string {
  return `使用者強制重啟，略過進行中：${describeLongRuns(list)}`
}

export class LongRunBusyError extends Error {
  readonly runs: LongRunEntry[]
  constructor(list: LongRunEntry[]) {
    super(longRunBusyMessage(list))
    this.runs = list
  }
}

export function assertNoLongRuns(): void {
  const list = listLongRuns()
  if (list.length > 0) throw new LongRunBusyError(list)
}

/** 409 回應本體：error 給舊前端直接顯示，longRuns 給新前端列出名稱、開始時間、PID */
export function longRunBusyBody(list: LongRunEntry[] = listLongRuns(), message?: string) {
  return {
    success: false as const,
    code: 'long-run-busy' as const,
    error: message ?? longRunBusyMessage(list),
    longRuns: list.map((r) => ({ name: r.name, startedAt: r.startedAt, pid: r.pid, step: r.step ?? null })),
  }
}

/**
 * 重啟 phase 執行前的最後防線：route 入口已 409，但從入口到真正重啟之間（例如升級下載期間）
 * 仍可能有人開始安裝。這裡等登記表清空再重啟；超過上限就照常重啟並留下紀錄（不讓升級永遠卡住）。
 * 回傳 true 表示登記表已空。
 */
export async function waitForNoLongRuns(
  log: (text: string) => void = () => {},
  opts: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<boolean> {
  const pollMs = opts.pollMs ?? 5_000
  const maxWaitMs = opts.maxWaitMs ?? 30 * 60_000
  if (!hasLongRuns()) return true
  log(`等待長時間作業完成後再重啟：${describeLongRuns(listLongRuns())}`)
  const deadline = Date.now() + maxWaitMs
  while (hasLongRuns()) {
    if (Date.now() >= deadline) {
      log(`等待逾時（${Math.round(maxWaitMs / 60_000)} 分鐘），仍在進行：${describeLongRuns(listLongRuns())}；照常重啟`)
      return false
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  log('長時間作業已結束，繼續重啟')
  return true
}

/** 測試用：清空登記表與重啟旗標，並可換掉 PID 存活檢查 */
export function _resetLongRunsForTest(pidProbe?: (pid: number) => boolean): void {
  runs().clear()
  store[PENDING_KEY] = null
  store[PROBE_KEY] = pidProbe
}
