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
  detectGatewayServiceNodeRuntime,
  detectOpenclawNodeRuntime,
  gatewayUnitCandidates,
  nodeSatisfiesEngine,
  parseNodeShebang,
  parseServiceNodeRunner,
  runOpenclawNodePreflight,
} from '@/lib/openclaw/node-preflight'
import {
  NODE_BLOCK_MESSAGE_KEY,
  fillMessageTemplate,
  nodeBlockMessageValues,
  type NodePreflightBlockDetails,
} from '@/lib/openclaw/node-preflight-message'
import en from '../../messages/en.json'
import zhTW from '../../messages/zh-TW.json'
import zhCN from '../../messages/zh-CN.json'

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
  const oldCli = { version: '24.16.0', path: '/x/cli/node' }
  const goodCli = { version: '26.12.1', path: '/x/cli/node' }
  const oldSvc = { version: '26.12.0', path: '/x/svc/node' }
  const goodSvc = { version: '26.12.1', path: '/x/svc/node' }

  it('gateway service Node OK + CLI Node too old → no block, warn (the installed updater prefers the service Node)', () => {
    const r = decideNodePreflight({ target, cli: oldCli, service: goodSvc })
    expect(r.verdict).toBe('warn')
    if (r.verdict === 'warn') {
      expect(r.message).toContain('24.16.0')
      expect(r.message).toContain('/x/svc/node')
    }
  })

  it('both CLI and gateway service Node too old → block (both-fail), naming both', () => {
    const r = decideNodePreflight({ target, cli: oldCli, service: oldSvc })
    expect(r.verdict).toBe('block')
    if (r.verdict !== 'block') return
    expect(r.details).toEqual({
      reason: 'both-fail', targetVersion: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE,
      cliVersion: '24.16.0', cliPath: '/x/cli/node', serviceVersion: '26.12.0', servicePath: '/x/svc/node',
    })
    for (const part of ['2026.10.7', OPENCLAW_2026_10_6_NODE_ENGINE, '24.16.0', '/x/cli/node', '26.12.0', '/x/svc/node', '仍要嘗試']) {
      expect(r.message).toContain(part)
    }
  })

  it('gateway service Node unknown + CLI Node too old → block with the softened "may refuse" text', () => {
    const r = decideNodePreflight({ target, cli: oldCli, service: null })
    expect(r.verdict).toBe('block')
    if (r.verdict !== 'block') return
    expect(r.details.reason).toBe('service-unknown')
    expect(r.message.startsWith('OpenClaw 可能會拒絕這次升級')).toBe(true)
    expect(r.message).toContain('仍要嘗試')
    expect(r.message).toContain('自己改用或安裝相容的 Node')
    expect(r.message).not.toContain('這台主機的 Node')
  })

  it('treats a service Node version the range cannot judge as unknown (softened block)', () => {
    const r = decideNodePreflight({ target, cli: oldCli, service: { version: 'garbage', path: '/x/svc/node' } })
    expect(r.verdict === 'block' && r.details.reason).toBe('service-unknown')
  })

  it('blocks Node 25 on both sides too (not a supported line)', () => {
    const n25 = { version: '25.9.0', path: '/x/node' }
    expect(decideNodePreflight({ target, cli: n25, service: n25 }).verdict).toBe('block')
  })

  it('passes a compatible CLI Node regardless of the service Node (OpenClaw handles that side)', () => {
    expect(decideNodePreflight({ target, cli: goodCli, service: oldSvc })).toEqual({ verdict: 'ok' })
    expect(decideNodePreflight({ target, cli: goodCli, service: null })).toEqual({ verdict: 'ok' })
  })

  it('passes when the target declares no Node requirement', () => {
    expect(decideNodePreflight({ target: { version: '2026.10.7', nodeEngine: null }, cli: null, service: null })).toEqual({ verdict: 'ok' })
  })

  it('warns but does not block when the target is unknown', () => {
    expect(decideNodePreflight({ target: null, cli: oldCli, service: oldSvc }).verdict).toBe('warn')
  })

  it('warns but does not block when the CLI Node cannot be detected, even if the service Node is old', () => {
    const r = decideNodePreflight({ target, cli: null, service: oldSvc })
    expect(r.verdict).toBe('warn')
    if (r.verdict === 'warn') expect(r.message).toContain(OPENCLAW_2026_10_6_NODE_ENGINE)
  })

  it('warns but does not block on an engines range it cannot parse', () => {
    const r = decideNodePreflight({ target: { version: '2027.1.1', nodeEngine: '24 - 26' }, cli: oldCli, service: oldSvc })
    expect(r.verdict).toBe('warn')
  })
})

describe('block message i18n', () => {
  const locales = { en, 'zh-TW': zhTW, 'zh-CN': zhCN }
  const details: NodePreflightBlockDetails = {
    reason: 'both-fail', targetVersion: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE,
    cliVersion: '24.16.0', cliPath: '/a/node', serviceVersion: '26.12.0', servicePath: '/b/node',
  }

  it('server message is the zh-TW template filled in (no drift between API error and UI)', () => {
    for (const service of [{ version: '26.12.0', path: '/b/node' }, null]) {
      const r = decideNodePreflight({
        target: { version: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE },
        cli: { version: '24.16.0', path: '/a/node' },
        service,
      })
      if (r.verdict !== 'block') throw new Error('expected block')
      const template = zhTW.openclawNodePreflight[NODE_BLOCK_MESSAGE_KEY[r.details.reason]]
      expect(r.message).toBe(fillMessageTemplate(template, nodeBlockMessageValues(r.details)))
      expect(r.message).not.toMatch(/\{\w+\}/)
    }
  })

  it('every locale has both block texts with the same placeholders, says "may" and points to try-anyway', () => {
    for (const [loc, msgs] of Object.entries(locales)) {
      const ns = msgs.openclawNodePreflight
      for (const key of Object.values(NODE_BLOCK_MESSAGE_KEY)) {
        const placeholders = (ns[key].match(/\{\w+\}/g) ?? []).sort()
        expect(placeholders, `${loc}.${key}`).toEqual((zhTW.openclawNodePreflight[key].match(/\{\w+\}/g) ?? []).sort())
        expect(ns[key], `${loc}.${key}`).toContain(ns.tryAnyway)
      }
      expect(fillMessageTemplate(ns.blockedBothFail, nodeBlockMessageValues(details))).toContain('/b/node')
    }
    expect(en.openclawNodePreflight.blockedServiceUnknown.startsWith('OpenClaw may refuse this upgrade')).toBe(true)
    expect(zhCN.openclawNodePreflight.blockedServiceUnknown.startsWith('OpenClaw 可能会拒绝这次升级')).toBe(true)
  })
})

describe('runOpenclawNodePreflight', () => {
  it('treats failing lookups as unknown → warn, never throws', async () => {
    const r = await runOpenclawNodePreflight({
      fetchTarget: () => Promise.reject(new Error('offline')),
      detectCliNode: () => Promise.reject(new Error('boom')),
      detectServiceNode: () => Promise.reject(new Error('boom')),
    })
    expect(r.verdict).toBe('warn')
  })

  it('a failing service lookup counts as unknown → softened block on a bad CLI Node', async () => {
    const r = await runOpenclawNodePreflight({
      fetchTarget: async () => ({ version: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE }),
      detectCliNode: async () => ({ version: '24.16.0', path: '/a/node' }),
      detectServiceNode: () => Promise.reject(new Error('boom')),
    })
    expect(r.verdict === 'block' && r.details.reason).toBe('service-unknown')
  })
})

describe('gateway service Node (same rule as OpenClaw resolveManagedServiceNodeRunner)', () => {
  it('takes the ExecStart interpreter when it is node and `gateway` comes after the script', () => {
    const unit = '[Service]\nType=simple\nExecStart=/opt/n/bin/node /p/openclaw/dist/index.js gateway --port 18789\n'
    expect(parseServiceNodeRunner(unit)).toBe('/opt/n/bin/node')
    expect(parseServiceNodeRunner('ExecStart=-"/opt/my node/node" /p/index.js gateway')).toBe('/opt/my node/node')
  })

  it('returns null when the service is not started through node', () => {
    expect(parseServiceNodeRunner('ExecStart=/usr/local/bin/openclaw gateway --port 1')).toBeNull()
    expect(parseServiceNodeRunner('ExecStart=/opt/bun /p/index.js gateway')).toBeNull()
    expect(parseServiceNodeRunner('ExecStart=/opt/n/bin/node /p/index.js serve')).toBeNull()
    expect(parseServiceNodeRunner('[Service]\nType=simple\n')).toBeNull()
  })

  it('looks for openclaw-gateway then openclaw user units under XDG_CONFIG_HOME or ~/.config', () => {
    expect(gatewayUnitCandidates({}, '/home/u')).toEqual([
      '/home/u/.config/systemd/user/openclaw-gateway.service',
      '/home/u/.config/systemd/user/openclaw.service',
    ])
    expect(gatewayUnitCandidates({ XDG_CONFIG_HOME: '/cfg' }, '/home/u')[0]).toBe('/cfg/systemd/user/openclaw-gateway.service')
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

  it('reads the gateway unit ExecStart node and asks it for its version (execFile mocked)', async () => {
    const svcNode = path.join(dir, 'svc', 'bin', 'node')
    writeExec(svcNode, '#!/bin/sh\necho v0\n')
    const unit = path.join(dir, 'systemd', 'user', 'openclaw-gateway.service')
    mkdirSync(path.dirname(unit), { recursive: true })
    writeFileSync(unit, `[Service]\nExecStart=${svcNode} /p/dist/index.js gateway --port 18789\n`)
    m.execFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      expect(file).toBe(svcNode)
      expect(args).toEqual(['--version'])
      cb(null, { stdout: 'v26.12.1\n', stderr: '' })
    })
    expect(await detectGatewayServiceNodeRuntime([unit, path.join(dir, 'nope.service')])).toEqual({ version: '26.12.1', path: svcNode })
  })

  it('gateway unit missing or its node gone → null, nothing executed', async () => {
    expect(await detectGatewayServiceNodeRuntime([path.join(dir, 'none.service')])).toBeNull()
    const unit = path.join(dir, 'openclaw-gateway.service')
    writeFileSync(unit, `ExecStart=${path.join(dir, 'gone', 'node')} /p/index.js gateway\n`)
    expect(await detectGatewayServiceNodeRuntime([unit])).toBeNull()
    expect(m.execFile).not.toHaveBeenCalled()
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
      detectGatewayServiceNodeRuntime: vi.fn(),
    }))
    // 記憶體預檢另有測試（openclaw-update-memory-guard.test.ts）；這裡固定為通過、gateway 沒在跑（不加停／啟 phase）
    vi.doMock('@/lib/openclaw/update-memory-guard', async (orig) => ({
      ...(await orig<typeof import('@/lib/openclaw/update-memory-guard')>()),
      runOpenclawMemoryPreflight: async () => ({
        preflight: { verdict: 'ok', estimateMb: 4000, warnings: [] },
        gateway: { unit: 'openclaw-gateway', running: false, anonKb: 0 },
      }),
    }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/openclaw/node-preflight')
    vi.doUnmock('@/lib/openclaw/update-memory-guard')
  })

  const load = async () => (await import('@/app/api/action/route')).POST

  const details: NodePreflightBlockDetails = {
    reason: 'service-unknown', targetVersion: '2026.10.7', nodeEngine: OPENCLAW_2026_10_6_NODE_ENGINE,
    cliVersion: '26.12.0', cliPath: '/usr/bin/node',
  }
  const blocked = { verdict: 'block', message: 'OpenClaw 可能會拒絕這次升級：… Node 26.12.0 …', details }

  it('stops before starting the job when Node is too old (409 node-unsupported)', async () => {
    m.preflight.mockResolvedValue(blocked)
    const res = await (await load())(post({ action: 'update-openclaw', triggeredBy: 'settings-card' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, code: 'node-unsupported', preflight: details })
    expect(body.error).toContain('26.12.0')
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('force runs the upgrade anyway and records the override in the job log', async () => {
    m.preflight.mockResolvedValue(blocked)
    const res = await (await load())(post({ action: 'update-openclaw', force: true }))
    expect(res.status).toBe(200)
    const phases = m.startJob.mock.calls[0][0].phases as Array<{ name: string; shell?: string; inline?: unknown }>
    expect(phases.map(p => p.name)).toEqual(['Upgrade preflight', 'openclaw update --yes', 'check leftover update files'])
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
    expect(phases.map(p => p.name)).toEqual(['openclaw update --yes', 'check leftover update files'])
    expect(phases[0]).toMatchObject({ shell: 'openclaw update --yes 2>&1' })
  })
})
