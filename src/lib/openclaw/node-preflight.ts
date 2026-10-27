import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import zhTW from '../../../messages/zh-TW.json'
import {
  NODE_BLOCK_MESSAGE_KEY,
  fillMessageTemplate,
  nodeBlockMessageValues,
  type NodePreflightBlockDetails,
} from './node-preflight-message'

const execFileP = promisify(execFile)

/**
 * 從 MCC 升級 OpenClaw 前的 Node 版本預檢。
 *
 * OpenClaw 2026.10.6 起把 package.json 的 `engines.node` 拉高到 `>=24.22.1 <25 || >=26.12.1`
 * （10.5 是 `>=24.16.0 <25 || >=26.1.0`）；套件自己的 node-version.mjs 也是同一組下限：Node 24、26
 * 各有同大版的最低版本，25 不支援，27 以上視為支援。
 *
 * 真正執行升級的是**已安裝的舊版** updater（客戶機上目前是 10.5）：它向 registry 取目標版的
 * `engines.node`，先試 gateway 服務定義裡的 Node（unit ExecStart 的直譯器），不符合再試 CLI 這支、
 * 再試自己找或安裝相容的 Node，全部失敗才拒絕，而且拒絕前不會改動任何東西。所以 MCC 只在
 * 「CLI 與 gateway 服務的 Node 都確定不符合」時擋；服務的 Node 讀不到時退而只看 CLI，但文案只說「可能」
 * 被拒，並指向「仍要嘗試」。規則一律取目標版的 `engines.node`（與 updater 同源），不寫死；
 * 取不到目標版或偵測不到 CLI 的 Node 時只警告、不擋。
 */

/** OpenClaw 2026.10.6／10.7 的 engines.node（npm view 實測），測試與文件用 */
export const OPENCLAW_2026_10_6_NODE_ENGINE = '>=24.22.1 <25 || >=26.12.1'

type Triple = [number, number, number]

/** `v26.12.1`、`26.12.1`、`24.22.1-nightly…` → [26, 12, 1]；解析失敗回 null */
export function parseNodeVersion(raw: string | null | undefined): Triple | null {
  if (typeof raw !== 'string') return null
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/.exec(raw.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function cmp(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

type Comparator = (v: Triple) => boolean

/** 單一 comparator（`>=24.22.1`、`<25`、`^26.1.0`、`24.x`…）→ 判斷函式；不認得回 null */
function parseComparator(token: string): Comparator | null {
  if (token === '*' || token === 'x' || token === 'X') return () => true
  const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(token)
  if (!m) return null
  const op = m[1] ?? ''
  const isWild = (s: string | undefined) => s === undefined || /^[xX*]$/.test(s)
  const major = Number(m[2])
  const minorWild = isWild(m[3])
  const patchWild = minorWild || isWild(m[4])
  const minor = minorWild ? 0 : Number(m[3])
  const patch = patchWild ? 0 : Number(m[4])
  const base: Triple = [major, minor, patch]
  // 部分版本（`24`、`24.22`）的上界：下一個 major／minor
  const partialUpper: Triple = minorWild ? [major + 1, 0, 0] : [major, minor + 1, 0]

  switch (op) {
    case '>=': return v => cmp(v, base) >= 0
    case '>': return patchWild ? v => cmp(v, partialUpper) >= 0 : v => cmp(v, base) > 0
    case '<': return v => cmp(v, base) < 0
    case '<=': return patchWild ? v => cmp(v, partialUpper) < 0 : v => cmp(v, base) <= 0
    case '^': {
      const upper: Triple = major > 0 ? [major + 1, 0, 0] : minor > 0 ? [0, minor + 1, 0] : [0, 0, patch + 1]
      return v => cmp(v, base) >= 0 && cmp(v, upper) < 0
    }
    case '~': {
      const upper: Triple = minorWild ? [major + 1, 0, 0] : [major, minor + 1, 0]
      return v => cmp(v, base) >= 0 && cmp(v, upper) < 0
    }
    default:
      return patchWild
        ? v => cmp(v, base) >= 0 && cmp(v, partialUpper) < 0
        : v => cmp(v, base) === 0
  }
}

/**
 * Node 版本是否符合 npm `engines.node` 範圍。只支援 engines 實際會用到的子集（`||`、空白分隔的
 * comparator、`^`、`~`、x-range）；遇到不認得的語法（例如 `1.2.3 - 2.3.4`）回 null，呼叫端當成「無法判斷」。
 */
export function nodeSatisfiesEngine(nodeVersion: string, range: string): boolean | null {
  const v = parseNodeVersion(nodeVersion)
  if (!v) return null
  const trimmed = range.trim()
  if (!trimmed) return true
  let any = false
  for (const alt of trimmed.split('||')) {
    const tokens = alt.trim().split(/\s+/).filter(Boolean)
    // `>= 24.22.1` 這種運算子與版本分開寫的情況
    const joined: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      if (/^(>=|<=|>|<|=|\^|~)$/.test(tokens[i]) && i + 1 < tokens.length) joined.push(tokens[i] + tokens[++i])
      else joined.push(tokens[i])
    }
    const comparators = joined.map(parseComparator)
    if (comparators.some(c => c === null)) return null
    if ((comparators as Comparator[]).every(c => c(v))) any = true
  }
  return any
}

export interface NodeRuntime {
  /** `26.12.1`（不帶 v） */
  version: string
  path: string
}

export interface OpenclawTarget {
  version: string
  /** 目標版的 engines.node；套件沒宣告時為 null */
  nodeEngine: string | null
}

export type NodePreflight =
  | { verdict: 'ok' }
  | { verdict: 'warn'; message: string }
  | { verdict: 'block'; message: string; details: NodePreflightBlockDetails }

function blockMessage(details: NodePreflightBlockDetails): string {
  const template = zhTW.openclawNodePreflight[NODE_BLOCK_MESSAGE_KEY[details.reason]]
  return fillMessageTemplate(template, nodeBlockMessageValues(details))
}

/**
 * 預檢判斷（純函式）。只有 CLI 的 Node 確定不符合、且 gateway 服務的 Node 不是「確定符合」時才擋：
 * 服務的 Node 符合 → OpenClaw updater 會優先用它，只警告；服務的 Node 讀不到 → 擋，但文案說「可能」被拒。
 * 其餘不確定一律放行並帶警告。
 */
export function decideNodePreflight(input: {
  target: OpenclawTarget | null
  cli: NodeRuntime | null
  service: NodeRuntime | null
}): NodePreflight {
  const { target, cli, service } = input
  if (!target) {
    return { verdict: 'warn', message: 'Node 版本預檢略過：取不到 OpenClaw 最新版資訊（npm registry 無回應），無法確認新版需要的 Node 版本' }
  }
  const engine = target.nodeEngine
  if (!engine) return { verdict: 'ok' }
  if (!cli) {
    return {
      verdict: 'warn',
      message: `Node 版本預檢略過：偵測不到 openclaw 會用哪個 Node 執行；OpenClaw ${target.version} 需要 Node ${engine}，不符合時 OpenClaw 可能會拒絕升級`,
    }
  }
  const cliOk = nodeSatisfiesEngine(cli.version, engine)
  if (cliOk === null) {
    return {
      verdict: 'warn',
      message: `Node 版本預檢略過：看不懂 OpenClaw ${target.version} 的 Node 需求「${engine}」（目前 Node ${cli.version}）`,
    }
  }
  if (cliOk) return { verdict: 'ok' }

  const serviceOk = service ? nodeSatisfiesEngine(service.version, engine) : null
  if (service && serviceOk) {
    return {
      verdict: 'warn',
      message:
        `OpenClaw ${target.version} 需要 Node ${engine}；openclaw CLI 用的 Node ${cli.version}（${cli.path}）不符合，` +
        `但 gateway 服務用的 Node ${service.version}（${service.path}）符合，OpenClaw 會改用它升級`,
    }
  }
  const details: NodePreflightBlockDetails = service && serviceOk === false
    ? {
        reason: 'both-fail', targetVersion: target.version, nodeEngine: engine,
        cliVersion: cli.version, cliPath: cli.path, serviceVersion: service.version, servicePath: service.path,
      }
    : { reason: 'service-unknown', targetVersion: target.version, nodeEngine: engine, cliVersion: cli.version, cliPath: cli.path }
  return { verdict: 'block', message: blockMessage(details), details }
}

// ---------------------------------------------------------------------------
// 偵測（I/O）
// ---------------------------------------------------------------------------

/**
 * shebang 指定的 Node：`#!/usr/bin/env node`（含 `env -S node --flag`）→ 依 PATH 找 `node`；
 * `#!/abs/path/node` → 該路徑。不是 node 腳本回 null。
 */
export function parseNodeShebang(firstLine: string): { kind: 'path-lookup'; name: string } | { kind: 'absolute'; path: string } | null {
  const m = /^#!\s*(\S+)(.*)$/.exec(firstLine.trim())
  if (!m) return null
  const interp = m[1]
  const args = m[2].trim().split(/\s+/).filter(Boolean)
  if (path.basename(interp) === 'env') {
    const name = args.find(a => !a.startsWith('-'))
    return name && /^node(js)?$/.test(path.basename(name)) ? { kind: 'path-lookup', name } : null
  }
  return /^node(js)?$/.test(path.basename(interp)) ? { kind: 'absolute', path: interp } : null
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function whichIn(name: string, pathEnv: string): string | null {
  for (const dir of pathEnv.split(':').filter(Boolean)) {
    const p = path.join(dir, name)
    if (existsSync(p) && isExecutable(p)) return p
  }
  return null
}

function safeRealpath(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

/**
 * 找出升級 job 裡 `openclaw update --yes` 會用哪個 Node 執行：在 job shell 的 PATH（jobs/runner.ts 的
 * jobShellPath，與真正執行時同一份）找到 `openclaw`，讀它的 shebang 決定 Node，再取版本。
 * 是 MCC 自己這支 Node 就直接用 process.versions，否則跑 `<node> --version`。任何一步失敗回 null。
 */
export async function detectOpenclawNodeRuntime(pathEnv: string): Promise<NodeRuntime | null> {
  try {
    const bin = whichIn('openclaw', pathEnv)
    if (!bin) return null
    const firstLine = readFileSync(safeRealpath(bin), 'utf8').slice(0, 512).split('\n')[0]
    const shebang = parseNodeShebang(firstLine)
    if (!shebang) return null
    const nodePath = shebang.kind === 'absolute' ? shebang.path : whichIn(shebang.name, pathEnv)
    if (!nodePath) return null
    return await nodeRuntimeAt(nodePath)
  } catch {
    return null
  }
}

/** 某支 node 的版本：是 MCC 自己這支就用 process.versions，否則跑 `<node> --version`；失敗回 null */
async function nodeRuntimeAt(nodePath: string): Promise<NodeRuntime | null> {
  if (!path.isAbsolute(nodePath) || !existsSync(nodePath)) return null
  if (safeRealpath(nodePath) === safeRealpath(process.execPath)) {
    return { version: process.versions.node, path: nodePath }
  }
  const { stdout } = await execFileP(nodePath, ['--version'], { timeout: 5000 })
  const v = parseNodeVersion(String(stdout).trim())
  return v ? { version: v.join('.'), path: nodePath } : null
}

/**
 * gateway user unit 的候選路徑，順序照 OpenClaw 的 resolveGatewaySystemdServiceNameCandidates
 * （`openclaw-gateway`，舊安裝是 `openclaw`），目錄依 XDG_CONFIG_HOME（未設時 ~/.config）
 */
export function gatewayUnitCandidates(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  return ['openclaw-gateway', 'openclaw'].map(name => path.join(configHome, 'systemd', 'user', `${name}.service`))
}

function splitExecArgs(line: string): string[] {
  const args: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) args.push(m[1] ?? m[2] ?? m[3])
  return args
}

/**
 * 從 unit 內容取出 gateway 用的 Node，規則同 OpenClaw 的 resolveManagedServiceNodeRunner：
 * ExecStart 的參數裡 `gateway` 出現在第 2 個之後，且第 1 個的檔名是 node，才把第 1 個當成 Node。
 */
export function parseServiceNodeRunner(unitText: string): string | null {
  for (const raw of unitText.split('\n')) {
    const m = /^\s*ExecStart\s*=\s*(.*)$/.exec(raw)
    if (!m || !m[1].trim()) continue
    const args = splitExecArgs(m[1].trim().replace(/^[-@:+!]+/, ''))
    const runner = args.indexOf('gateway') > 1 ? args[0] : undefined
    return runner && /^node(\.exe)?$/i.test(path.basename(runner)) ? runner : null
  }
  return null
}

/** gateway 服務定義裡的 Node（OpenClaw updater 優先用的那支）；沒有 unit、不是 node 啟動或讀不到版本回 null */
export async function detectGatewayServiceNodeRuntime(unitPaths: string[] = gatewayUnitCandidates()): Promise<NodeRuntime | null> {
  try {
    const unit = unitPaths.find(p => existsSync(p))
    if (!unit) return null
    const runner = parseServiceNodeRunner(readFileSync(unit, 'utf8'))
    return runner ? await nodeRuntimeAt(runner) : null
  } catch {
    return null
  }
}

/** `openclaw update` 預設的目標：npm registry 的 `latest`（與升級卡片顯示的版本同源） */
export async function fetchOpenclawLatestTarget(): Promise<OpenclawTarget | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: unknown; engines?: { node?: unknown } | null }
    if (typeof data.version !== 'string' || !data.version) return null
    const node = data.engines?.node
    return { version: data.version, nodeEngine: typeof node === 'string' && node.trim() ? node.trim() : null }
  } catch {
    return null
  }
}

export async function runOpenclawNodePreflight(deps: {
  fetchTarget: () => Promise<OpenclawTarget | null>
  detectCliNode: () => Promise<NodeRuntime | null>
  detectServiceNode: () => Promise<NodeRuntime | null>
}): Promise<NodePreflight> {
  const [target, cli, service] = await Promise.all([
    deps.fetchTarget().catch(() => null),
    deps.detectCliNode().catch(() => null),
    deps.detectServiceNode().catch(() => null),
  ])
  return decideNodePreflight({ target, cli, service })
}
