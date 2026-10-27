import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// OpenClaw 2026.10.7 在寫設定前先載入外掛：2 vCPU throwaway 上一支 `config set` 要 15.7–19.5 s，
// 舊的 15 s 預設每次都把 agent 覆寫砍成 124（llm-auth-kimi E2E 必掛）。
// 這裡用假時鐘＋假子行程重現各種耗時；child_process 每個進入點預設都直接丟錯，絕不跑真的指令。

const cp = vi.hoisted(() => {
  const state: {
    spawn?: (cmd: string, args: string[]) => unknown
    execFile?: (...a: unknown[]) => unknown
  } = {}
  const refuse = (name: string) => (...a: unknown[]) => {
    throw new Error(`child_process.${name}(${String(a[0])}) 沒有在測試裡 mock，拒絕執行真的行程`)
  }
  const mod = {
    spawn: (...a: unknown[]) => (state.spawn ? state.spawn(a[0] as string, a[1] as string[]) : refuse('spawn')(...a)),
    execFile: (...a: unknown[]) => (state.execFile ? state.execFile(...a) : refuse('execFile')(...a)),
    exec: refuse('exec'),
    execSync: refuse('execSync'),
    execFileSync: refuse('execFileSync'),
    spawnSync: refuse('spawnSync'),
    fork: refuse('fork'),
  }
  return { state, mod }
})
vi.mock('node:child_process', () => ({ ...cp.mod, default: cp.mod }))
vi.mock('child_process', () => ({ ...cp.mod, default: cp.mod }))
// business-hours-gate 的 uninstall 會讀寫 ~/.openclaw/openclaw.json：讓它看不到，也寫不進去。
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const live = (p: unknown) => String(p).includes('/.openclaw/')
  const mod = {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) => (live(p) ? false : actual.existsSync(p)),
    writeFileSync: (p: Parameters<typeof actual.writeFileSync>[0], ...rest: unknown[]) => {
      if (live(p)) throw new Error(`test refused to write ${String(p)}`)
      return (actual.writeFileSync as (...a: unknown[]) => void)(p, ...rest)
    },
  }
  return { ...mod, default: mod }
})
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/server-env', () => ({ getServerEnv: () => ({}) }))

import {
  OPENCLAW_READ_TIMEOUT_MS,
  OPENCLAW_WRITE_TIMEOUT_MS,
  addAlias,
  addFallback,
  getStatus,
  removeAlias,
  removeFallback,
  reorderFallbacks,
  runOpenclaw,
  setAgentModelOverride,
  setDefault,
  writeAgentsConfigPath,
} from '@/lib/openclaw/models-config'
import { removeProfile } from '@/lib/openclaw/auth-profiles'
import { installPlugin, uninstallPlugin } from '@/lib/customer-service/business-hours-gate'

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding(): void }
  stderr: EventEmitter & { setEncoding(): void }
  kill(sig: string): boolean
  killedWith: string | null
}

/** 在 `ms` 毫秒後以 `code` 結束的子行程；`ms === null` 代表永遠不結束（只能被 kill）。 */
function fakeChild(ms: number | null, opts: { code?: number; stdout?: string; onDone?: () => void } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
  child.killedWith = null
  const done =
    ms === null
      ? null
      : setTimeout(() => {
          opts.onDone?.()
          if (opts.stdout) child.stdout.emit('data', opts.stdout)
          child.emit('close', opts.code ?? 0, null)
        }, ms)
  child.kill = (sig: string) => {
    if (done) clearTimeout(done)
    child.killedWith = sig
    queueMicrotask(() => child.emit('close', null, sig))
    return true
  }
  return child
}

/** argv 去掉 runOpenclaw 自己加的 `--log-level silent --no-color` */
const cmdOf = (args: string[]) => args.filter((a, i) => !(a === '--log-level' || args[i - 1] === '--log-level' || a === '--no-color'))

/** 觀察 promise 是否已結束，不讓 rejection 變成 unhandled */
function track<T>(p: Promise<T>) {
  const s = { done: false, value: undefined as T | undefined, error: undefined as unknown }
  p.then((v) => { s.done = true; s.value = v }, (e) => { s.done = true; s.error = e })
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  cp.state.spawn = undefined
  cp.state.execFile = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('runOpenclaw 讀取預設逾時', () => {
  it('讀取預設至少 60 s、寫入至少 90 s（10.7 實測：status 15.8 s、config set 最慢 19.5 s）', () => {
    expect(OPENCLAW_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
    expect(OPENCLAW_WRITE_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000)
  })

  it('15.8 s 的 `models --status-json` 不再被舊的 15 s 砍掉', async () => {
    cp.state.spawn = () => fakeChild(15_800, { stdout: '{"defaultModel":"a/b"}' })
    const s = track(getStatus('main'))
    await vi.advanceTimersByTimeAsync(15_800)
    expect(s.error).toBeUndefined()
    expect(s.done).toBe(true)
  })

  it('真的卡住的讀取在讀取逾時才被砍，回 124', async () => {
    let child: FakeChild | undefined
    cp.state.spawn = () => (child = fakeChild(null))
    const s = track(runOpenclaw(['config', 'get', 'agents']))
    await vi.advanceTimersByTimeAsync(OPENCLAW_READ_TIMEOUT_MS - 1)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(child?.killedWith).toBe('SIGTERM')
    expect(s.value?.code).toBe(124)
    expect(s.value?.stderr).toContain(`timed out after ${OPENCLAW_READ_TIMEOUT_MS}ms`)
  })
})

describe('agent 覆寫在 10.7 的耗時下成功', () => {
  /** 模擬 openclaw.json 的 agents 區段：get 3 s、set 依 setMs。 */
  function fakeOpenclaw(setMs: number | null) {
    let agents: Record<string, unknown> = { entries: { main: {} } }
    const spawned: string[][] = []
    const children: FakeChild[] = []
    cp.state.spawn = (_cmd, args) => {
      const c = cmdOf(args)
      spawned.push(c)
      let child: FakeChild
      if (c[0] === 'config' && c[1] === 'get' && c[2] === 'agents') {
        child = fakeChild(3_000, { stdout: JSON.stringify(agents) })
      } else if (c[0] === 'config' && c[1] === 'set' && c[2] === 'agents.entries') {
        child = fakeChild(setMs, { onDone: () => { agents = { ...agents, entries: JSON.parse(c[3]) } } })
      } else {
        throw new Error(`unexpected openclaw ${c.join(' ')}`)
      }
      children.push(child)
      return child
    }
    return { spawned, children }
  }

  it('19.5 s 的 config set 不被砍，覆寫寫入並驗證成功', async () => {
    const { spawned, children } = fakeOpenclaw(19_500)
    const s = track(setAgentModelOverride('main', { primary: 'kimi/kimi-for-coding' }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.error).toBeUndefined()
    expect(s.done).toBe(true)
    expect(spawned.filter((c) => c[1] === 'set')).toHaveLength(1)
    expect(children.every((c) => c.killedWith === null)).toBe(true)
  })

  it('卡住的 config set 在寫入逾時才被砍，錯誤註明逾時', async () => {
    fakeOpenclaw(null)
    const s = track(setAgentModelOverride('main', { primary: 'kimi/kimi-for-coding' }))
    // 先讀 3 s，再 set
    await vi.advanceTimersByTimeAsync(3_000 + OPENCLAW_WRITE_TIMEOUT_MS - 1)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.done).toBe(true)
    expect(String(s.error)).toMatch(/config set agents\.entries failed \(124\)/)
    expect(String(s.error)).toContain(`timed out after ${OPENCLAW_WRITE_TIMEOUT_MS}ms`)
  })
})

describe('其他寫設定的 CLI 都用寫入逾時', () => {
  const writers: Array<[string, () => Promise<void>]> = [
    ['models set', () => setDefault('main', 'kimi/kimi-for-coding')],
    ['fallbacks add', () => addFallback('main', 'kimi/kimi-for-coding')],
    ['fallbacks remove', () => removeFallback('main', 'kimi/kimi-for-coding')],
    ['fallbacks clear+add', () => reorderFallbacks('main', ['a/b'])],
    ['aliases add', () => addAlias('main', 'k', 'kimi/kimi-for-coding')],
    ['aliases remove', () => removeAlias('main', 'k')],
    ['config set agents（auth/remove 還原快照）', () => writeAgentsConfigPath('agents', { entries: {} })],
  ]

  it.each(writers)('%s：每支 19.5 s 都成功', async (_name, fn) => {
    const children: FakeChild[] = []
    cp.state.spawn = () => {
      const c = fakeChild(19_500)
      children.push(c)
      return c
    }
    const s = track(fn())
    await vi.advanceTimersByTimeAsync(19_500 * 2)
    expect(s.error).toBeUndefined()
    expect(s.done).toBe(true)
    expect(children.every((c) => c.killedWith === null)).toBe(true)
  })

  it.each(writers)('%s：卡住時撐到寫入逾時才失敗', async (_name, fn) => {
    cp.state.spawn = () => fakeChild(null)
    const s = track(fn())
    await vi.advanceTimersByTimeAsync(OPENCLAW_WRITE_TIMEOUT_MS - 1)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.done).toBe(true)
    expect(String(s.error)).toContain('124')
  })
})

describe('models auth logout（刪除登入）', () => {
  let dir: string
  let configPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-logout-timeout-'))
    configPath = join(dir, 'openclaw.json')
    writeFileSync(configPath, JSON.stringify({ auth: { profiles: { 'kimi:default': { provider: 'kimi', mode: 'api_key' } } } }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('20 s 的 logout 成功（舊的 30 s 只剩 1.5 倍餘裕）', async () => {
    const spawned: string[][] = []
    cp.state.spawn = (_cmd, args) => {
      spawned.push(cmdOf(args))
      return fakeChild(20_000)
    }
    const s = track(removeProfile('main', 'kimi:default', { configPath }))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(s.error).toBeUndefined()
    expect(s.done).toBe(true)
    expect(spawned[0]).toEqual(['models', 'auth', '--agent', 'main', 'logout', 'kimi:default', '--yes'])
  })

  it('卡住時撐到寫入逾時才失敗', async () => {
    cp.state.spawn = () => fakeChild(null)
    const s = track(removeProfile('main', 'kimi:default', { configPath }))
    await vi.advanceTimersByTimeAsync(OPENCLAW_WRITE_TIMEOUT_MS - 1)
    expect(s.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(String(s.error)).toContain(`timed out after ${OPENCLAW_WRITE_TIMEOUT_MS / 1000}s`)
  })
})

describe('營業時間閘門外掛：enable/disable/remove 用寫入逾時', () => {
  function recordExecFile() {
    const calls: Array<{ args: string[]; timeout: number }> = []
    cp.state.execFile = (_cmd: unknown, args: unknown, opts: unknown, cb: unknown) => {
      calls.push({ args: args as string[], timeout: (opts as { timeout: number }).timeout })
      ;(cb as (e: null, r: { stdout: string; stderr: string }) => void)(null, { stdout: 'ok', stderr: '' })
    }
    return calls
  }

  it('install 流程的每支 plugins enable', async () => {
    vi.useRealTimers()
    const calls = recordExecFile()
    await installPlugin()
    const enables = calls.filter((c) => c.args[0] === 'plugins' && c.args[1] === 'enable')
    expect(enables.length).toBeGreaterThan(0)
    for (const c of enables) expect(c.timeout, c.args.join(' ')).toBeGreaterThanOrEqual(OPENCLAW_WRITE_TIMEOUT_MS)
  })

  it('uninstall 的 plugins disable / remove', async () => {
    vi.useRealTimers()
    const calls = recordExecFile()
    await uninstallPlugin()
    const writes = calls.filter((c) => c.args[0] === 'plugins' && (c.args[1] === 'disable' || c.args[1] === 'remove'))
    expect(writes.map((c) => c.args[1])).toEqual(['disable', 'remove'])
    for (const c of writes) expect(c.timeout, c.args.join(' ')).toBeGreaterThanOrEqual(OPENCLAW_WRITE_TIMEOUT_MS)
  })
})
