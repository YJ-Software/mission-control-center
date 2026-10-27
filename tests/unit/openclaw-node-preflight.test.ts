import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 升級 OpenClaw 前的 Node 版本預檢。這條路徑會開 `openclaw update --yes` job：child_process 一律攔下，
 * 沒有明確設定回應的呼叫直接記一筆並丟錯，afterEach 檢查沒有任何漏網的真實執行。
 */

const m = vi.hoisted(() => {
  const unexpected: string[] = []
  const guard = (name: string) => (...args: unknown[]) => {
    unexpected.push(`${name} ${JSON.stringify(args[0])}`)
    throw new Error(`unmocked child_process.${name} in test`)
  }
  return {
    unexpected,
    guard,
    execFile: vi.fn(),
    startJob: vi.fn(),
    busy: vi.fn(),
    preflight: vi.fn(),
  }
})

vi.mock('child_process', async (orig) => ({
  ...(await orig<typeof import('child_process')>()),
  exec: vi.fn(m.guard('exec')), execSync: vi.fn(m.guard('execSync')), spawn: vi.fn(m.guard('spawn')),
  spawnSync: vi.fn(m.guard('spawnSync')), execFile: m.execFile, execFileSync: vi.fn(m.guard('execFileSync')),
}))
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  exec: vi.fn(m.guard('exec')), execSync: vi.fn(m.guard('execSync')), spawn: vi.fn(m.guard('spawn')),
  spawnSync: vi.fn(m.guard('spawnSync')), execFile: m.execFile, execFileSync: vi.fn(m.guard('execFileSync')),
}))
vi.mock('@/lib/backup/lock', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/jobs/runner', () => ({ startJob: m.startJob, jobShellPath: () => '/nonexistent' }))

import {
  OPENCLAW_2026_10_6_NODE_ENGINE,
  decideNodePreflight,
  detectOpenclawNodeRuntime,
  nodeSatisfiesEngine,
  parseNodeShebang,
  runOpenclawNodePreflight,
} from '@/lib/openclaw/node-preflight'

beforeEach(() => {
  m.unexpected.length = 0
  m.execFile.mockReset().mockImplementation(m.guard('execFile'))
  m.startJob.mockReset().mockReturnValue({ id: 'job-1' })
  m.busy.mockReset().mockReturnValue(false)
  m.preflight.mockReset()
})

afterEach(() => {
  expect(m.unexpected).toEqual([])
})

// OpenClaw 2026.10.7 node-version.mjs 的 isSupportedOpenClawNodeVersion：同大版取該大版下限，
// 沒有下限的大版只有比最高下限的大版還新才算支援（25 不支援、27+ 支援）
const FLOORS = [[24, 22, 1], [26, 12, 1]] as const
function openclawOwnCheck(v: [number, number, number]): boolean {
  const floor = FLOORS.find(f => f[0] === v[0])
  if (!floor) return v[0] > FLOORS[FLOORS.length - 1][0]
  if (v[1] !== floor[1]) return v[1] > floor[1]
  return v[2] >= floor[2]
}

describe('nodeSatisfiesEngine — OpenClaw 10.6+ 規則', () => {
  const E = OPENCLAW_2026_10_6_NODE_ENGINE

  it.each([
    ['22.20.0', false],
    ['24.16.0', false],
    ['24.22.0', false],
    ['24.22.1', true],
    ['v24.30.2', true],
    ['25.9.0', false],
    ['26.1.0', false],
    ['26.12.0', false], // 10.5 那次 throwaway 的 Node：10.6+ 會被拒
    ['26.12.1', true], // OCD NodeSource 26.x（10.7 E2E）
    ['26.13.0', true],
    ['27.0.0', true],
  ])('Node %s → %s', (v, expected) => {
    expect(nodeSatisfiesEngine(v, E)).toBe(expected)
  })

  it('agrees with OpenClaw 10.7 own floor check across a version sweep', () => {
    for (const major of [20, 22, 23, 24, 25, 26, 27, 28]) {
      for (const minor of [0, 1, 11, 12, 13, 21, 22, 23, 40]) {
        for (const patch of [0, 1, 2]) {
          const v: [number, number, number] = [major, minor, patch]
          expect(nodeSatisfiesEngine(v.join('.'), E), v.join('.')).toBe(openclawOwnCheck(v))
        }
      }
    }
  })

  it('10.5 engine still accepts 26.12.0', () => {
    expect(nodeSatisfiesEngine('26.12.0', '>=24.16.0 <25 || >=26.1.0')).toBe(true)
  })

  it('handles other common engines syntax', () => {
    expect(nodeSatisfiesEngine('24.22.1', '>= 24.22.1')).toBe(true)
    expect(nodeSatisfiesEngine('26.2.0', '^26.1.0')).toBe(true)
    expect(nodeSatisfiesEngine('27.0.0', '^26.1.0')).toBe(false)
    expect(nodeSatisfiesEngine('24.9.9', '24.x')).toBe(true)
    expect(nodeSatisfiesEngine('25.0.0', '24.x')).toBe(false)
    expect(nodeSatisfiesEngine('24.0.0', '>24')).toBe(false)
    expect(nodeSatisfiesEngine('25.0.0', '>24')).toBe(true)
    expect(nodeSatisfiesEngine('24.99.0', '<=24')).toBe(true)
    expect(nodeSatisfiesEngine('22.0.0', '*')).toBe(true)
    expect(nodeSatisfiesEngine('22.0.0', '')).toBe(true)
  })

  it('returns null (unknown) for syntax it does not understand or a bad version', () => {
    expect(nodeSatisfiesEngine('24.22.1', '24.0.0 - 26.0.0')).toBeNull()
    expect(nodeSatisfiesEngine('not-a-version', E)).toBeNull()
  })
})

describe('parseNodeShebang', () => {
  it('reads env-style and absolute node shebangs', () => {
    expect(parseNodeShebang('#!/usr/bin/env node')).toEqual({ kind: 'path-lookup', name: 'node' })
    expect(parseNodeShebang('#!/usr/bin/env -S node --no-warnings')).toEqual({ kind: 'path-lookup', name: 'node' })
    expect(parseNodeShebang('#!/opt/node/bin/node')).toEqual({ kind: 'absolute', path: '/opt/node/bin/node' })
  })

  it('ignores non-node scripts', () => {
    expect(parseNodeShebang('#!/bin/sh')).toBeNull()
    expect(parseNodeShebang('#!/usr/bin/env bun')).toBeNull()
    expect(parseNodeShebang('console.log(1)')).toBeNull()
  })
})

describe('decideNodePreflight', () => {
  const target = { version: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE }

  it('blocks when the detected Node is below the target requirement, naming both', () => {
    const r = decideNodePreflight({ target, node: { version: '26.12.0', path: '/usr/bin/node' } })
    expect(r.verdict).toBe('block')
    if (r.verdict !== 'block') return
    expect(r.message).toContain('26.12.0')
    expect(r.message).toContain(OPENCLAW_2026_10_6_NODE_ENGINE)
    expect(r.message).toContain('2026.10.7')
    expect(r.message).toContain('/usr/bin/node')
  })

  it('blocks Node 25 too (not a supported line)', () => {
    expect(decideNodePreflight({ target, node: { version: '25.9.0', path: '/x/node' } }).verdict).toBe('block')
  })

  it('passes a compatible Node', () => {
    expect(decideNodePreflight({ target, node: { version: '26.12.1', path: '/usr/bin/node' } })).toEqual({ verdict: 'ok' })
  })

  it('passes when the target declares no Node requirement', () => {
    expect(decideNodePreflight({ target: { version: '2026.10.7', nodeEngine: null }, node: null })).toEqual({ verdict: 'ok' })
  })

  it('warns but does not block when the target is unknown', () => {
    const r = decideNodePreflight({ target: null, node: { version: '20.0.0', path: '/usr/bin/node' } })
    expect(r.verdict).toBe('warn')
  })

  it('warns but does not block when Node cannot be detected', () => {
    const r = decideNodePreflight({ target, node: null })
    expect(r.verdict).toBe('warn')
    if (r.verdict === 'warn') expect(r.message).toContain(OPENCLAW_2026_10_6_NODE_ENGINE)
  })

  it('warns but does not block on an engines range it cannot parse', () => {
    const r = decideNodePreflight({ target: { version: '2027.1.1', nodeEngine: '24 - 26' }, node: { version: '20.0.0', path: '/n' } })
    expect(r.verdict).toBe('warn')
  })
})

describe('runOpenclawNodePreflight', () => {
  it('treats failing lookups as unknown → warn, never throws', async () => {
    const r = await runOpenclawNodePreflight({
      fetchTarget: () => Promise.reject(new Error('offline')),
      detectNode: () => Promise.reject(new Error('boom')),
    })
    expect(r.verdict).toBe('warn')
  })
})

describe('detectOpenclawNodeRuntime', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'mcc-node-preflight-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function writeExec(p: string, body: string) {
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, body)
    chmodSync(p, 0o755)
  }

  it('resolves `#!/usr/bin/env node` along the given PATH; MCC own node needs no spawn', async () => {
    writeExec(path.join(dir, 'bin', 'openclaw'), '#!/usr/bin/env node\nimport "./x.mjs"\n')
    const pathEnv = [path.join(dir, 'bin'), path.dirname(process.execPath)].join(':')
    const r = await detectOpenclawNodeRuntime(pathEnv)
    expect(r?.version).toBe(process.versions.node)
    expect(m.execFile).not.toHaveBeenCalled()
  })

  it('asks a different node for its version (execFile mocked)', async () => {
    const fakeNode = path.join(dir, 'other', 'node')
    writeExec(fakeNode, '#!/bin/sh\necho v0\n')
    writeExec(path.join(dir, 'bin', 'openclaw'), `#!${fakeNode}\n`)
    m.execFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      expect(file).toBe(fakeNode)
      expect(args).toEqual(['--version'])
      cb(null, { stdout: 'v26.12.0\n', stderr: '' })
    })
    const r = await detectOpenclawNodeRuntime(path.join(dir, 'bin'))
    expect(r).toEqual({ version: '26.12.0', path: fakeNode })
  })

  it('returns null when openclaw is not on the PATH', async () => {
    expect(await detectOpenclawNodeRuntime(path.join(dir, 'empty'))).toBeNull()
  })
})

describe('/api/action update-openclaw preflight', () => {
  const post = (body: unknown) =>
    new NextRequest('http://mcc.local/api/action', { method: 'POST', body: JSON.stringify(body) })

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/openclaw/node-preflight', () => ({
      runOpenclawNodePreflight: m.preflight,
      fetchOpenclawLatestTarget: vi.fn(),
      detectOpenclawNodeRuntime: vi.fn(),
    }))
  })
  afterEach(() => { vi.doUnmock('@/lib/openclaw/node-preflight') })

  const load = async () => (await import('@/app/api/action/route')).POST

  const blocked = {
    verdict: 'block', message: 'OpenClaw 2026.10.7 需要 Node >=24.22.1 <25 || >=26.12.1，但 openclaw 目前用 Node 26.12.0',
    nodeVersion: '26.12.0', nodePath: '/usr/bin/node', targetVersion: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE,
  }

  it('stops before starting the job when Node is too old (409 node-unsupported)', async () => {
    m.preflight.mockResolvedValue(blocked)
    const res = await (await load())(post({ action: 'update-openclaw', triggeredBy: 'settings-card' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, code: 'node-unsupported' })
    expect(body.error).toContain('26.12.0')
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('force runs the upgrade anyway and records the override in the job log', async () => {
    m.preflight.mockResolvedValue(blocked)
    const res = await (await load())(post({ action: 'update-openclaw', force: true }))
    expect(res.status).toBe(200)
    const phases = m.startJob.mock.calls[0][0].phases as Array<{ name: string; shell?: string; inline?: unknown }>
    expect(phases.map(p => p.name)).toEqual(['Node version preflight', 'openclaw update --yes'])
  })

  it('unknown → starts the job, with the warning as the first phase and in the response', async () => {
    m.preflight.mockResolvedValue({ verdict: 'warn', message: 'Node 版本預檢略過：…' })
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, jobId: 'job-1', warning: 'Node 版本預檢略過：…' })
    const phases = m.startJob.mock.calls[0][0].phases as Array<{ name: string; inline?: (log: (s: string, t: string) => void) => Promise<number> }>
    const logged: string[] = []
    expect(await phases[0].inline!((_s, t) => { logged.push(t) })).toBe(0)
    expect(logged).toEqual(['Node 版本預檢略過：…'])
  })

  it('compatible → only the update phase', async () => {
    m.preflight.mockResolvedValue({ verdict: 'ok' })
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect(res.status).toBe(200)
    expect((await res.json()).warning).toBeUndefined()
    const phases = m.startJob.mock.calls[0][0].phases as Array<{ name: string; shell?: string }>
    expect(phases).toEqual([{ name: 'openclaw update --yes', shell: 'openclaw update --yes 2>&1' }])
  })
})
