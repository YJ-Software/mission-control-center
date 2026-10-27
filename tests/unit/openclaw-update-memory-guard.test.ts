import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 升級 OpenClaw 前的記憶體預檢與 gateway 停／啟。這條路徑會呼叫 systemctl、開 `openclaw update --yes` job：
 * child_process 一律攔下，沒有明確設定回應的呼叫直接記一筆並丟錯，afterEach 檢查沒有任何漏網的真實執行。
 */

const m = vi.hoisted(() => {
  const unexpected: string[] = []
  const guard = (name: string) => (...args: unknown[]) => {
    unexpected.push(`${name} ${JSON.stringify(args[0])} ${JSON.stringify(args[1])}`)
    throw new Error(`unmocked child_process.${name} in test`)
  }
  return {
    unexpected,
    guard,
    execFile: vi.fn(),
    startJob: vi.fn(),
    busy: vi.fn(),
    nodePreflight: vi.fn(),
    memoryPreflight: vi.fn(),
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
  OPENCLAW_UPDATE_REQUIRED_MB,
  decideMemoryPreflight,
  findLeftoverUpdateStageDirs,
  inspectGatewayService,
  parseMeminfo,
  parseStatusAnonKb,
  parseSystemctlShow,
  readGatewayAnonKb,
  resolveGatewayUnitName,
  runOpenclawMemoryPreflight,
  startGatewayPhase,
  stopGatewayPhase,
  type GatewayService,
} from '@/lib/openclaw/update-memory-guard'
import {
  MEMORY_BLOCK_MESSAGE_KEY,
  isMemoryPreflightBlockDetails,
  memoryBlockMessageValues,
  type MemoryPreflightBlockDetails,
} from '@/lib/openclaw/memory-preflight-message'
import { fillMessageTemplate } from '@/lib/openclaw/node-preflight-message'
import en from '../../messages/en.json'
import zhTW from '../../messages/zh-TW.json'
import zhCN from '../../messages/zh-CN.json'

type ExecCb = (err: (Error & { code?: number }) | null, stdout: string, stderr: string) => void

/** execFile 依 argv 回應；沒列到的呼叫走 guard（記一筆並丟錯） */
function respond(table: Array<{ match: (file: string, args: string[]) => boolean; code?: number; stdout?: string; stderr?: string }>) {
  m.execFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const hit = table.find(t => t.match(file, args))
    if (!hit) return m.guard('execFile')(file, args)
    const code = hit.code ?? 0
    const err = code === 0 ? null : Object.assign(new Error(`exit ${code}`), { code })
    queueMicrotask(() => cb(err, hit.stdout ?? '', hit.stderr ?? ''))
    return {}
  })
}
const systemctl = (...want: string[]) => (file: string, args: string[]) =>
  file === 'systemctl' && want.every((w, i) => args[i] === w)

beforeEach(() => {
  m.unexpected.length = 0
  m.execFile.mockReset().mockImplementation(m.guard('execFile'))
  m.startJob.mockReset().mockReturnValue({ id: 'job-1' })
  m.busy.mockReset().mockReturnValue(false)
  m.nodePreflight.mockReset().mockResolvedValue({ verdict: 'ok' })
  m.memoryPreflight.mockReset()
})

afterEach(() => {
  expect(m.unexpected).toEqual([])
})

// 2026-10-28 throwaway 實測（OpenClaw 2026.10.7、4 GB 無 swap）：gateway 在跑時
const THROWAWAY_MEMINFO = 'MemTotal:        4008840 kB\nMemFree:          312232 kB\nMemAvailable:    1274228 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n'

describe('parsers', () => {
  it('reads MemAvailable and SwapFree from /proc/meminfo', () => {
    expect(parseMeminfo(THROWAWAY_MEMINFO)).toEqual({ memAvailableKb: 1274228, swapFreeKb: 0 })
    expect(parseMeminfo('MemAvailable: 100 kB\n')).toEqual({ memAvailableKb: 100, swapFreeKb: 0 })
    expect(parseMeminfo('MemTotal: 1 kB\n')).toBeNull()
    expect(parseMeminfo('')).toBeNull()
  })

  it('counts RssAnon + RssShmem from /proc/<pid>/status (file-backed pages are already in MemAvailable)', () => {
    expect(parseStatusAnonKb('VmRSS:\t1298004 kB\nRssAnon:\t1200000 kB\nRssFile:\t90000 kB\nRssShmem:\t8004 kB\n')).toBe(1208004)
    expect(parseStatusAnonKb('VmRSS:\t10 kB\n')).toBeNull()
  })

  it('parses systemctl show output', () => {
    expect(parseSystemctlShow('LoadState=loaded\nActiveState=active\nMainPID=3638\nControlGroup=/user.slice/x.service\n')).toEqual({
      LoadState: 'loaded', ActiveState: 'active', MainPID: '3638', ControlGroup: '/user.slice/x.service',
    })
  })
})

describe('decideMemoryPreflight', () => {
  const gw = (anonMb: number | null, running = true): GatewayService => ({
    unit: 'openclaw-gateway', running, anonKb: anonMb === null ? null : anonMb * 1024,
  })
  const mem = (availMb: number, swapMb = 0) => ({ memAvailableKb: availMb * 1024, swapFreeKb: swapMb * 1024 })

  it('counts the gateway that will be stopped: the 2026-10-28 throwaway passes once the gateway is out of the way', () => {
    // MemAvailable 1244 MB 單看不夠，但停掉 gateway（約 1.3 GB）後有 2.57 GB
    const r = decideMemoryPreflight({ meminfo: parseMeminfo(THROWAWAY_MEMINFO), gateway: gw(1330) })
    expect(r).toMatchObject({ verdict: 'ok', estimateMb: 1244 + 1330, warnings: [] })
  })

  it('blocks when even with the gateway stopped there is not enough memory, with every number in the details', () => {
    const r = decideMemoryPreflight({ meminfo: mem(500, 100), gateway: gw(700) })
    expect(r.verdict).toBe('block')
    if (r.verdict !== 'block') return
    expect(r.details).toEqual({ estimateMb: 1300, requiredMb: OPENCLAW_UPDATE_REQUIRED_MB, memAvailableMb: 500, swapFreeMb: 100, gatewayMb: 700 })
    expect(r.message).toContain('1300 MB')
    expect(r.message).toContain(`${OPENCLAW_UPDATE_REQUIRED_MB} MB`)
  })

  it('counts free swap', () => {
    expect(decideMemoryPreflight({ meminfo: mem(1000, 2000), gateway: gw(0) }).verdict).toBe('ok')
  })

  it('a gateway that is not running frees nothing', () => {
    const r = decideMemoryPreflight({ meminfo: mem(1000), gateway: { unit: 'openclaw-gateway', running: false, anonKb: 0 } })
    expect(r).toMatchObject({ verdict: 'block', details: { gatewayMb: 0, estimateMb: 1000 } })
  })

  it('/proc/meminfo unreadable → warn, never block', () => {
    const r = decideMemoryPreflight({ meminfo: null, gateway: gw(1000) })
    expect(r.verdict).toBe('warn')
    expect(r.warnings.join()).toContain('/proc/meminfo')
  })

  it('gateway memory unreadable → warn instead of a possibly false block', () => {
    const r = decideMemoryPreflight({ meminfo: mem(1000), gateway: gw(null) })
    expect(r.verdict).toBe('warn')
    expect(r.warnings.join()).toContain('讀不到 gateway 佔用的記憶體')
  })

  it('no gateway unit → still checks memory, warns that the gateway will not be stopped', () => {
    expect(decideMemoryPreflight({ meminfo: mem(3000), gateway: null })).toMatchObject({ verdict: 'warn', estimateMb: 3000 })
    expect(decideMemoryPreflight({ meminfo: mem(800), gateway: null }).verdict).toBe('block')
  })
})

describe('block message i18n', () => {
  const details: MemoryPreflightBlockDetails = { estimateMb: 1300, requiredMb: 2000, memAvailableMb: 500, swapFreeMb: 100, gatewayMb: 700 }

  it('server message is the zh-TW template filled in (no drift between API error and UI)', () => {
    const r = decideMemoryPreflight({ meminfo: { memAvailableKb: 500 * 1024, swapFreeKb: 100 * 1024 }, gateway: { unit: 'u', running: true, anonKb: 700 * 1024 }, requiredMb: 2000 })
    expect(r.verdict === 'block' && r.message).toBe(fillMessageTemplate(zhTW.openclawMemoryPreflight.blocked, memoryBlockMessageValues(details)))
  })

  it('every locale has the block text with the same placeholders, plus the confirm and button texts', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort()
    const want = placeholders(zhTW.openclawMemoryPreflight.blocked)
    expect(want).toEqual(Object.keys(memoryBlockMessageValues(details)).sort())
    for (const loc of [en, zhTW, zhCN]) {
      expect(placeholders(loc.openclawMemoryPreflight[MEMORY_BLOCK_MESSAGE_KEY])).toEqual(want)
      expect(loc.openclawMemoryPreflight.confirmTryAnyway).toBeTruthy()
      expect(loc.openclawMemoryPreflight.tryAnyway).toBeTruthy()
    }
  })

  it('recognises the 409 details shape', () => {
    expect(isMemoryPreflightBlockDetails(details)).toBe(true)
    expect(isMemoryPreflightBlockDetails({ ...details, gatewayMb: '700' })).toBe(false)
    expect(isMemoryPreflightBlockDetails(null)).toBe(false)
  })
})

describe('gateway service detection (systemctl mocked)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'mcc-memguard-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('picks the first unit file that exists, in OpenClaw candidate order (openclaw-gateway, then legacy openclaw)', () => {
    const a = path.join(dir, 'openclaw-gateway.service')
    const b = path.join(dir, 'openclaw.service')
    writeFileSync(b, '')
    expect(resolveGatewayUnitName([a, b])).toBe('openclaw')
    writeFileSync(a, '')
    expect(resolveGatewayUnitName([a, b])).toBe('openclaw-gateway')
    expect(resolveGatewayUnitName([path.join(dir, 'nope.service')])).toBeNull()
  })

  it('sums anonymous memory over every process in the unit cgroup; falls back to MainPID', () => {
    const files: Record<string, string> = {
      '/sys/fs/cgroup/user.slice/gw.service/cgroup.procs': '3638\n3652\n3782\n',
      '/proc/3638/status': 'RssAnon:\t1200000 kB\nRssShmem:\t0 kB\n',
      '/proc/3652/status': 'RssAnon:\t70000 kB\n',
      '/proc/3782/status': 'RssAnon:\t80000 kB\n',
    }
    const read = (p: string) => files[p] ?? null
    expect(readGatewayAnonKb({ ControlGroup: '/user.slice/gw.service', MainPID: '3638' }, read)).toBe(1350000)
    expect(readGatewayAnonKb({ ControlGroup: '/missing', MainPID: '3638' }, read)).toBe(1200000)
    expect(readGatewayAnonKb({ MainPID: '0' }, read)).toBeNull()
  })

  it('inspects the unit through systemctl --user show', async () => {
    respond([{ match: systemctl('--user', 'show', 'openclaw-gateway.service'), stdout: 'LoadState=loaded\nActiveState=active\nMainPID=0\nControlGroup=\n' }])
    expect(await inspectGatewayService('openclaw-gateway')).toEqual({ unit: 'openclaw-gateway', running: true, anonKb: null })
    respond([{ match: systemctl('--user', 'show', 'openclaw-gateway.service'), stdout: 'LoadState=loaded\nActiveState=inactive\nMainPID=0\n' }])
    expect(await inspectGatewayService('openclaw-gateway')).toEqual({ unit: 'openclaw-gateway', running: false, anonKb: 0 })
    respond([{ match: systemctl('--user', 'show', 'openclaw-gateway.service'), stdout: 'LoadState=not-found\nActiveState=inactive\n' }])
    expect(await inspectGatewayService('openclaw-gateway')).toBeNull()
    respond([{ match: systemctl('--user', 'show'), code: 1, stderr: 'Failed to connect to bus' }])
    expect(await inspectGatewayService('openclaw-gateway')).toBeNull()
    expect(await inspectGatewayService(null)).toBeNull()
  })

  it('runOpenclawMemoryPreflight treats failing lookups as unknown → warn, never throws', async () => {
    const r = await runOpenclawMemoryPreflight({
      readMeminfo: () => { throw new Error('EACCES') },
      inspectGateway: () => Promise.reject(new Error('boom')),
    })
    expect(r.gateway).toBeNull()
    expect(r.preflight.verdict).toBe('warn')
  })

  it('lists leftover updater staging dirs next to the installed openclaw, without touching them', () => {
    const modules = path.join(dir, 'lib', 'node_modules')
    mkdirSync(path.join(modules, 'openclaw'), { recursive: true })
    mkdirSync(path.join(modules, '.openclaw.update-stage-FEpEgW'))
    writeFileSync(path.join(modules, 'openclaw', 'openclaw.mjs'), '#!/usr/bin/env node\n', { mode: 0o755 })
    mkdirSync(path.join(dir, 'bin'))
    symlinkSync('../lib/node_modules/openclaw/openclaw.mjs', path.join(dir, 'bin', 'openclaw'))
    expect(findLeftoverUpdateStageDirs(path.join(dir, 'bin'))).toEqual([path.join(modules, '.openclaw.update-stage-FEpEgW')])
    expect(findLeftoverUpdateStageDirs(path.join(dir, 'nothing'))).toEqual([])
  })
})

describe('gateway stop / start phases (systemctl mocked)', () => {
  const logs = () => {
    const lines: string[] = []
    return { lines, log: (_s: string, t: string) => { lines.push(t) } }
  }

  it('stop phase stops the unit; a failed stop fails the phase', async () => {
    respond([{ match: systemctl('--user', 'stop', 'openclaw-gateway.service') }])
    expect(await stopGatewayPhase('openclaw-gateway').inline(logs().log)).toBe(0)
    respond([{ match: systemctl('--user', 'stop', 'openclaw-gateway.service'), code: 5, stderr: 'Unit not loaded' }])
    const l = logs()
    expect(await stopGatewayPhase('openclaw-gateway').inline(l.log)).toBe(5)
    expect(l.lines.join('\n')).toContain('Unit not loaded')
  })

  it('start phase is alwaysRun and starts a stopped gateway (the OpenClaw updater leaves an externally stopped gateway stopped)', async () => {
    respond([
      { match: systemctl('--user', 'is-active', 'openclaw-gateway.service'), code: 3, stdout: 'inactive\n' },
      { match: systemctl('--user', 'start', 'openclaw-gateway.service') },
    ])
    const phase = startGatewayPhase('openclaw-gateway')
    expect(phase.alwaysRun).toBe(true)
    expect(await phase.inline(logs().log)).toBe(0)
    expect(m.execFile.mock.calls.map(c => c[1][1])).toEqual(['is-active', 'start'])
  })

  it('start phase leaves an already running gateway alone (no second restart)', async () => {
    respond([{ match: systemctl('--user', 'is-active', 'openclaw-gateway.service'), stdout: 'active\n' }])
    expect(await startGatewayPhase('openclaw-gateway').inline(logs().log)).toBe(0)
    expect(m.execFile).toHaveBeenCalledTimes(1)
  })

  it('a failed start fails the phase and tells the user the command to run', async () => {
    respond([
      { match: systemctl('--user', 'is-active', 'openclaw-gateway.service'), code: 3, stdout: 'failed\n' },
      { match: systemctl('--user', 'start', 'openclaw-gateway.service'), code: 1, stderr: 'Job failed' },
    ])
    const l = logs()
    expect(await startGatewayPhase('openclaw-gateway').inline(l.log)).toBe(1)
    expect(l.lines.join('\n')).toContain('systemctl --user start openclaw-gateway.service')
  })
})

describe('/api/action update-openclaw with the memory guard', () => {
  const post = (body: unknown) =>
    new NextRequest('http://mcc.local/api/action', { method: 'POST', body: JSON.stringify(body) })

  const memDetails: MemoryPreflightBlockDetails = { estimateMb: 1300, requiredMb: 2000, memAvailableMb: 500, swapFreeMb: 100, gatewayMb: 700 }
  const memBlocked = { verdict: 'block', message: '主機記憶體可能不足以升級 OpenClaw：…1300 MB…', details: memDetails, warnings: [] }
  const running: GatewayService = { unit: 'openclaw-gateway', running: true, anonKb: 700 * 1024 }
  const nodeBlocked = {
    verdict: 'block', message: 'OpenClaw 可能會拒絕這次升級：…',
    details: { reason: 'service-unknown', targetVersion: '2026.10.8', nodeEngine: '>=24.22.1 <25 || >=26.12.1', cliVersion: '26.12.0', cliPath: '/usr/bin/node' },
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/openclaw/node-preflight', () => ({
      runOpenclawNodePreflight: m.nodePreflight,
      fetchOpenclawLatestTarget: vi.fn(),
      detectOpenclawNodeRuntime: vi.fn(),
      detectGatewayServiceNodeRuntime: vi.fn(),
    }))
    vi.doMock('@/lib/openclaw/update-memory-guard', async (orig) => ({
      ...(await orig<typeof import('@/lib/openclaw/update-memory-guard')>()),
      runOpenclawMemoryPreflight: m.memoryPreflight,
    }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/openclaw/node-preflight')
    vi.doUnmock('@/lib/openclaw/update-memory-guard')
  })

  const load = async () => (await import('@/app/api/action/route')).POST
  type Phase = { name: string; shell?: string; timeoutMs?: number; alwaysRun?: boolean; inline?: (log: (s: string, t: string) => void) => Promise<number> }
  const phasesOf = () => m.startJob.mock.calls[0][0].phases as Phase[]

  it('409 memory-insufficient before any job when memory is too low, even with the gateway stopped', async () => {
    m.memoryPreflight.mockResolvedValue({ preflight: memBlocked, gateway: running })
    const res = await (await load())(post({ action: 'update-openclaw', triggeredBy: 'settings-card' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ success: false, code: 'memory-insufficient', preflight: memDetails })
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('memory wins when both checks block (a hung host is worse than a refused upgrade)', async () => {
    m.memoryPreflight.mockResolvedValue({ preflight: memBlocked, gateway: running })
    m.nodePreflight.mockResolvedValue(nodeBlocked)
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect((await res.json()).code).toBe('memory-insufficient')
  })

  it('node block still works when memory is fine', async () => {
    m.memoryPreflight.mockResolvedValue({ preflight: { verdict: 'ok', estimateMb: 2600, warnings: [] }, gateway: running })
    m.nodePreflight.mockResolvedValue(nodeBlocked)
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('node-unsupported')
  })

  it('normal run: stop gateway → update (with a backstop timeout) → start gateway (alwaysRun) → leftover check', async () => {
    m.memoryPreflight.mockResolvedValue({ preflight: { verdict: 'ok', estimateMb: 2600, warnings: [] }, gateway: running })
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect(res.status).toBe(200)
    expect((await res.json()).warning).toBeUndefined()
    const phases = phasesOf()
    expect(phases.map(p => p.name)).toEqual([
      'stop openclaw-gateway (free memory for the update)',
      'openclaw update --yes --no-restart',
      'start openclaw-gateway',
      'check leftover update files',
    ])
    // updater 換版時會在自己還佔著記憶體時就重啟 gateway：由 MCC 在它結束後才啟動
    expect(phases[1]).toMatchObject({ shell: 'openclaw update --yes --no-restart 2>&1' })
    expect(phases[1].timeoutMs).toBeGreaterThanOrEqual(30 * 60_000)
    expect(phases[0].alwaysRun).toBeFalsy()
    expect(phases[2].alwaysRun).toBe(true)
    expect(phases[3].alwaysRun).toBe(true)
  })

  it('force skips both blocks and records each override in the job log', async () => {
    m.memoryPreflight.mockResolvedValue({ preflight: memBlocked, gateway: running })
    m.nodePreflight.mockResolvedValue(nodeBlocked)
    const res = await (await load())(post({ action: 'update-openclaw', force: true }))
    expect(res.status).toBe(200)
    const phases = phasesOf()
    expect(phases[0].name).toBe('Upgrade preflight')
    const logged: string[] = []
    expect(await phases[0].inline!((_s, t) => { logged.push(t) })).toBe(0)
    expect(logged.join('\n')).toContain('使用者確認後略過記憶體預檢')
    expect(logged.join('\n')).toContain('使用者確認後略過 Node 版本預檢')
    expect(phases.map(p => p.name)).toContain('stop openclaw-gateway (free memory for the update)')
  })

  it('a gateway that is already stopped is neither stopped nor started by the job (and the updater keeps its own restart)', async () => {
    m.memoryPreflight.mockResolvedValue({
      preflight: { verdict: 'ok', estimateMb: 2600, warnings: [] },
      gateway: { unit: 'openclaw-gateway', running: false, anonKb: 0 },
    })
    await (await load())(post({ action: 'update-openclaw' }))
    expect(phasesOf().map(p => p.name)).toEqual(['openclaw update --yes', 'check leftover update files'])
  })

  it('while an OpenClaw upgrade job runs, restarting the gateway or starting another upgrade is refused (409)', async () => {
    const { registerLongRun, unregisterLongRun } = await import('@/lib/long-running')
    const id = registerLongRun('Upgrade OpenClaw CLI', { kind: 'upgrade-openclaw' })
    try {
      const POST = await load()
      for (const action of ['restart-openclaw', 'update-openclaw']) {
        const res = await POST(post({ action, force: true }))
        expect(res.status).toBe(409)
        expect((await res.json()).code).toBe('openclaw-upgrading')
      }
      expect(m.startJob).not.toHaveBeenCalled()
      expect(m.memoryPreflight).not.toHaveBeenCalled()
    } finally {
      unregisterLongRun(id)
    }
  })

  it('unknown memory → job starts with the warning in the first phase and in the response', async () => {
    m.memoryPreflight.mockResolvedValue({
      preflight: { verdict: 'warn', estimateMb: null, warnings: ['記憶體預檢略過：讀不到 /proc/meminfo'] },
      gateway: null,
    })
    const res = await (await load())(post({ action: 'update-openclaw' }))
    expect(await res.json()).toMatchObject({ success: true, warning: '記憶體預檢略過：讀不到 /proc/meminfo' })
    expect(phasesOf().map(p => p.name)).toEqual(['Upgrade preflight', 'openclaw update --yes', 'check leftover update files'])
  })
})
