import { describe, it, expect } from 'vitest'
import {
  createOpenClawBackup,
  verifyOpenClawBackup,
  restoreOpenClawBackup,
  type OpenClawBackendDeps,
} from '@/lib/backup/openclaw-backend'

const HOME = '/home/u'

/** 記憶體假 fs：node = 字串(檔案內容) | 物件(目錄) | {link} (symlink) */
type Node = string | { [k: string]: Node } | { __link: string }
function isDir(n: Node | undefined): n is { [k: string]: Node } {
  return typeof n === 'object' && n !== null && !('__link' in n)
}
class FakeFs {
  root: { [k: string]: Node } = {}
  failOn: { op: string; match: RegExp; once?: boolean }[] = []
  private parts(p: string) {
    return p.split('/').filter(Boolean)
  }
  private parent(p: string, create = false) {
    const ps = this.parts(p)
    const name = ps.pop()!
    let cur = this.root
    for (const seg of ps) {
      let next = cur[seg]
      if (!isDir(next)) {
        if (!create) return null
        next = cur[seg] = {}
      }
      cur = next
    }
    return { dir: cur, name }
  }
  private get(p: string): Node | undefined {
    const pr = this.parent(p)
    return pr ? pr.dir[pr.name] : undefined
  }
  private maybeFail(op: string, p: string) {
    const f = this.failOn.find((x) => x.op === op && x.match.test(p))
    if (f) {
      if (f.once) this.failOn.splice(this.failOn.indexOf(f), 1)
      throw new Error(`injected ${op} failure on ${p}`)
    }
  }
  put(p: string, n: Node) {
    const pr = this.parent(p, true)!
    pr.dir[pr.name] = n
  }
  snapshot(p: string): Node | undefined {
    const n = this.get(p)
    return n === undefined ? undefined : JSON.parse(JSON.stringify(n))
  }
  existsSync = (p: string) => this.get(p) !== undefined
  readdirSync = ((p: string) => {
    const n = this.get(p)
    if (!isDir(n)) throw new Error(`ENOTDIR ${p}`)
    return Object.keys(n).sort()
  }) as unknown as OpenClawBackendDeps['fs']['readdirSync']
  renameSync = (a: string, b: string) => {
    this.maybeFail('rename', a + ' -> ' + b)
    const src = this.parent(a)
    if (!src || src.dir[src.name] === undefined) throw new Error(`ENOENT ${a}`)
    const dst = this.parent(b)
    if (!dst) throw new Error(`ENOENT parent of ${b}`)
    if (dst.dir[dst.name] !== undefined) throw new Error(`EEXIST ${b}`)
    dst.dir[dst.name] = src.dir[src.name]
    delete src.dir[src.name]
  }
  rmSync = ((p: string, o?: { force?: boolean }) => {
    this.maybeFail('rm', p)
    const pr = this.parent(p)
    if (!pr || pr.dir[pr.name] === undefined) {
      if (o?.force) return
      throw new Error(`ENOENT ${p}`)
    }
    delete pr.dir[pr.name]
  }) as unknown as OpenClawBackendDeps['fs']['rmSync']
  cpSync = ((a: string, b: string, o?: { verbatimSymlinks?: boolean }) => {
    this.maybeFail('cp', a + ' -> ' + b)
    if (!o?.verbatimSymlinks) throw new Error('cpSync must use verbatimSymlinks')
    const n = this.get(a)
    if (n === undefined) throw new Error(`ENOENT ${a}`)
    this.put(b, JSON.parse(JSON.stringify(n)))
  }) as unknown as OpenClawBackendDeps['fs']['cpSync']
  mkdirSync = ((p: string) => {
    if (!isDir(this.get(p))) this.put(p, {})
    return undefined
  }) as unknown as OpenClawBackendDeps['fs']['mkdirSync']
  private n = 0
  mkdtempSync = ((prefix: string) => {
    const p = `${prefix}${++this.n}`
    this.put(p, {})
    return p
  }) as unknown as OpenClawBackendDeps['fs']['mkdtempSync']
}

const LIVE_OPENCLAW = (): { [k: string]: Node } => ({
  'openclaw.json': 'LIVE-CONFIG',
  agents: { main: 'LIVE-AGENT' },
  extensions: { big: 'LIVE-EXT' },
  npm: { pkg: 'LIVE-NPM' },
  tmp: { x: 'LIVE-TMP' },
  skills: { s1: { __link: '../../.agents/skills/s1' } },
})
const STAGED_OPENCLAW = (): { [k: string]: Node } => ({
  'openclaw.json': 'RESTORED-CONFIG',
  agents: { main: 'RESTORED-AGENT' },
  extensions: { small: 'RESTORED-EXT' },
  skills: { s1: { __link: '../../.agents/skills/s1' } },
})

function setup(opts: { healthy?: boolean | 'throw'; restoreCode?: number } = {}) {
  const fs = new FakeFs()
  fs.put(`${HOME}/.openclaw`, LIVE_OPENCLAW())
  fs.put(`${HOME}/.agents/skills/s1`, { f: 'LIVE-SKILL-S1' })
  fs.put(`${HOME}/.agents/skills/mine`, { f: 'LIVE-MINE' })
  const calls: string[][] = []
  const events: string[] = []
  const logs: string[] = []
  const deps: OpenClawBackendDeps = {
    fs: fs as unknown as OpenClawBackendDeps['fs'],
    home: HOME,
    now: () => new Date('2026-10-06T08:00:00.123Z'),
    log: (_s, t) => logs.push(t),
    gateway: {
      stop: async () => void events.push('stop'),
      start: async () => void events.push('start'),
      waitHealthy: async () => {
        events.push('wait')
        if (opts.healthy === 'throw') throw new Error('probe boom')
        return opts.healthy !== false
      },
    },
    run: async (args) => {
      calls.push(args)
      if (args[1] === 'restore') {
        if (opts.restoreCode) return { code: opts.restoreCode, stdout: '', stderr: 'restore exploded' }
        const target = args[args.indexOf('--target') + 1]
        const base = `${target}/ROOT/payload/posix${HOME}`
        fs.put(`${base}/.openclaw`, STAGED_OPENCLAW())
        fs.put(`${base}/.agents/skills/s1`, { f: 'RESTORED-SKILL-S1' })
        return { code: 0, stdout: `noise line\n${JSON.stringify({ ok: true, archiveRoot: 'ROOT' })}\n`, stderr: '' }
      }
      if (args[1] === 'create') {
        return {
          code: 0,
          stdout: JSON.stringify({ verified: true, archivePath: '/out/a.tar.gz', warnings: ['w1'] }),
          stderr: '',
        }
      }
      return { code: 0, stdout: JSON.stringify({ ok: true, runtimeVersion: '2026.9.8' }), stderr: '' }
    },
  }
  return { fs, deps, calls, events, logs }
}

describe('createOpenClawBackup / verify', () => {
  it('returns archivePath + verify version; args include --output --verify --json; warnings logged', async () => {
    const { deps, calls, logs } = setup()
    const r = await createOpenClawBackup('/out', deps)
    expect(r).toEqual({ archivePath: '/out/a.tar.gz', version: '2026.9.8', warnings: ['w1'] })
    expect(calls[0]).toEqual(['backup', 'create', '--output', '/out', '--verify', '--json'])
    expect(calls[1]).toEqual(['backup', 'verify', '/out/a.tar.gz', '--json'])
    expect(logs).toContain('w1')
  })
  it('throws when verified is false, including stderr tail', async () => {
    const { deps } = setup()
    deps.run = async () => ({ code: 0, stdout: '{"verified":false,"archivePath":"/x"}', stderr: 'bad-sum' })
    await expect(createOpenClawBackup('/out', deps)).rejects.toThrow(/bad-sum/)
  })
  it('throws on non-zero exit', async () => {
    const { deps } = setup()
    deps.run = async () => ({ code: 2, stdout: '', stderr: 'disk full' })
    await expect(createOpenClawBackup('/out', deps)).rejects.toThrow(/disk full/)
  })
  it('throws when the post-create verify fails (unverified backup is not good)', async () => {
    const { deps } = setup()
    let n = 0
    deps.run = async () =>
      n++ === 0
        ? { code: 0, stdout: '{"verified":true,"archivePath":"/x"}', stderr: '' }
        : { code: 1, stdout: '', stderr: 'verify broke' }
    await expect(createOpenClawBackup('/out', deps)).rejects.toThrow(/verify broke/)
  })
  it('verify throws when ok !== true', async () => {
    const { deps } = setup()
    deps.run = async () => ({ code: 0, stdout: '{"ok":false}', stderr: '' })
    await expect(verifyOpenClawBackup('/a', deps)).rejects.toThrow()
  })
})

describe('restoreOpenClawBackup', () => {
  const PRE = `${HOME}/.openclaw.pre-restore-2026-10-06T08-00-00-123Z`

  it('success: staged content live, extensions/npm/tmp from live, pre kept, stop→start, symlinks preserved', async () => {
    const { fs, deps, events } = setup()
    const r = await restoreOpenClawBackup('/a.tar.gz', deps)
    expect(r.preRestoreDir).toBe(PRE)
    const live = fs.snapshot(`${HOME}/.openclaw`) as { [k: string]: Node }
    expect(live['openclaw.json']).toBe('RESTORED-CONFIG')
    expect(live.agents).toEqual({ main: 'RESTORED-AGENT' })
    expect(live.extensions).toEqual({ big: 'LIVE-EXT' })
    expect(live.npm).toEqual({ pkg: 'LIVE-NPM' })
    expect(live.tmp).toEqual({ x: 'LIVE-TMP' })
    expect(live.skills).toEqual({ s1: { __link: '../../.agents/skills/s1' } })
    // pre 保留原 live 的其餘部分
    const pre = fs.snapshot(PRE) as { [k: string]: Node }
    expect(pre['openclaw.json']).toBe('LIVE-CONFIG')
    expect(pre.agents).toEqual({ main: 'LIVE-AGENT' })
    expect(pre.extensions).toBeUndefined()
    // managed skills：被取代者改名保留，沒被碰的不動
    expect(fs.snapshot(`${HOME}/.agents/skills/s1`)).toEqual({ f: 'RESTORED-SKILL-S1' })
    expect(fs.snapshot(`${HOME}/.agents/skills/s1.pre-restore-2026-10-06T08-00-00-123Z`)).toEqual({ f: 'LIVE-SKILL-S1' })
    expect(fs.snapshot(`${HOME}/.agents/skills/mine`)).toEqual({ f: 'LIVE-MINE' })
    expect(events).toEqual(['stop', 'start', 'wait'])
    // staging 已清除
    expect(fs.readdirSync(HOME).filter((n) => n.startsWith('.openclaw-restore-staging'))).toEqual([])
  })

  it('backup restore fails: live untouched, gateway never stopped, staging removed', async () => {
    const { fs, deps, events } = setup({ restoreCode: 3 })
    const before = fs.snapshot(HOME)
    await expect(restoreOpenClawBackup('/a.tar.gz', deps)).rejects.toThrow(/restore exploded/)
    expect(fs.snapshot(HOME)).toEqual(before) // staging 目錄也已清掉，整個 home 逐項相同
    expect(events).toEqual([])
  })

  it('archive without .openclaw: throws before touching live', async () => {
    const { fs, deps, events } = setup()
    const run = deps.run
    deps.run = async (args, t) => {
      if (args[1] === 'restore') {
        const target = args[args.indexOf('--target') + 1]
        fs.put(`${target}/ROOT/payload/posix${HOME}/other`, {})
        return { code: 0, stdout: '{"archiveRoot":"ROOT"}', stderr: '' }
      }
      return run(args, t)
    }
    const before = fs.snapshot(`${HOME}/.openclaw`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/\.openclaw/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(before)
    expect(events).toEqual([])
  })

  it('unhealthy after restore: rolled back exactly, error says rolled back, gateway last event is start', async () => {
    const { fs, deps, events } = setup({ healthy: false })
    const beforeOpenclaw = fs.snapshot(`${HOME}/.openclaw`)
    const beforeSkills = fs.snapshot(`${HOME}/.agents`)
    await expect(restoreOpenClawBackup('/a.tar.gz', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(beforeOpenclaw)
    expect(fs.snapshot(`${HOME}/.agents`)).toEqual(beforeSkills)
    expect(fs.existsSync(PRE)).toBe(false)
    expect(events[events.length - 1]).toBe('start')
    expect(events).toEqual(['stop', 'start', 'wait', 'stop', 'start'])
    // 失敗的還原內容留作檢視
    const failed = fs.snapshot(`${HOME}/.openclaw.failed-restore-2026-10-06T08-00-00-123Z`) as { [k: string]: Node }
    expect(failed['openclaw.json']).toBe('RESTORED-CONFIG')
  })

  it('waitHealthy throwing counts as unhealthy and rolls back', async () => {
    const { fs, deps } = setup({ healthy: 'throw' })
    const before = fs.snapshot(`${HOME}/.openclaw`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(before)
  })

  it('failure mid carry-over (step 5) rolls back exactly', async () => {
    const { fs, deps, events } = setup()
    fs.failOn.push({ op: 'rename', match: /pre-restore-.*\/npm -> /, once: true })
    const before = fs.snapshot(`${HOME}/.openclaw`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(before)
    expect(events).toEqual(['stop', 'stop', 'start'])
  })

  it('failure copying a skill (step 6) rolls back openclaw dir and skills', async () => {
    const { fs, deps } = setup()
    fs.failOn.push({ op: 'cp', match: /skills\/s1 -> /, once: true })
    const b1 = fs.snapshot(`${HOME}/.openclaw`)
    const b2 = fs.snapshot(`${HOME}/.agents`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(b1)
    expect(fs.snapshot(`${HOME}/.agents`)).toEqual(b2)
  })

  it('failure moving staged into place (step 4b) restores the original', async () => {
    const { fs, deps } = setup()
    fs.failOn.push({ op: 'rename', match: /payload.*\.openclaw -> /, once: true })
    const before = fs.snapshot(`${HOME}/.openclaw`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(before)
  })

  it('gateway.start failing after swap rolls back too', async () => {
    const { fs, deps } = setup()
    let n = 0
    const origStart = deps.gateway.start
    deps.gateway.start = async () => {
      if (n++ === 0) throw new Error('start failed')
      return origStart()
    }
    const before = fs.snapshot(`${HOME}/.openclaw`)
    await expect(restoreOpenClawBackup('/a', deps)).rejects.toThrow(/rolled back/)
    expect(fs.snapshot(`${HOME}/.openclaw`)).toEqual(before)
  })

  it('rollback itself fails: error names both failures and the pre-restore dir; pre dir never deleted', async () => {
    const { fs, deps } = setup({ healthy: false })
    fs.failOn.push({ op: 'rename', match: /^\/home\/u\/\.openclaw\.pre-restore-.* -> \/home\/u\/\.openclaw$/ , once: true })
    // 該規則會在 undo 4a 時觸發（4a 的正向 rename 是 live -> pre，不符）
    let msg = ''
    try {
      await restoreOpenClawBackup('/a', deps)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/not healthy/)
    expect(msg).toMatch(/rollback failed/)
    expect(msg).toMatch(/Manual recovery/)
    expect(msg).toContain(PRE)
    expect(fs.existsSync(PRE)).toBe(true)
  })

  it('only ever runs backup create|verify|restore', async () => {
    const { deps, calls } = setup()
    await createOpenClawBackup('/out', deps)
    await restoreOpenClawBackup('/a', deps).catch(() => {})
    for (const c of calls) {
      expect(c[0]).toBe('backup')
      expect(['create', 'verify', 'restore']).toContain(c[1])
    }
    expect(calls.flat().join(' ')).not.toMatch(/uninstall|reset/)
  })
})
