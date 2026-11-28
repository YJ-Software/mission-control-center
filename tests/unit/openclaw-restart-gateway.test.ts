import { processMocks } from './helpers/offline-owner-mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { restartOpenclawGateway } from '@/lib/openclaw/restart-gateway'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, realpathSync: vi.fn(actual.realpathSync), readFileSync: vi.fn(actual.readFileSync) }
})

const actualFs = await vi.importActual<typeof fs>('node:fs')
const unit = 'my-gateway.service'
const node = '/opt/mcc-test/bin/node'
const packageDir = '/opt/mcc-test/lib/openclaw'
const launcher = `${packageDir}/dist/index.js`
const configPort = 18789
let home: string
let state: string
let env: NodeJS.ProcessEnv
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  home = fs.mkdtempSync(path.join(tmpdir(), 'mcc-restart-'))
  state = path.join(home, '.openclaw')
  env = {
    NODE_ENV: 'test',
    HOME: home,
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_CONFIG_HOME: home,
    XDG_DATA_HOME: home,
    XDG_STATE_HOME: home,
    XDG_RUNTIME_DIR: home,
    OPENCLAW_STATE_DIR: state,
    OPENCLAW_SYSTEMD_UNIT: unit,
    OPENCLAW_GATEWAY_HTTP: 'http://127.0.0.1:18789',
    OPENCLAW_GATEWAY_WS: 'ws://127.0.0.1:18789',
  }
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  fs.mkdirSync(path.join(state, 'tmp'), { recursive: true })
  fs.chmodSync(path.join(state, 'tmp'), 0o775)
  fs.writeFileSync(path.join(state, 'openclaw.json'), JSON.stringify({ gateway: { port: configPort } }))
  vi.mocked(fs.readFileSync).mockImplementation((file, options) => {
    if (file === `${packageDir}/package.json`) return '{"name":"openclaw","version":"2026.11.6"}'
    return actualFs.readFileSync(file, options as 'utf8')
  })
  vi.mocked(fs.realpathSync).mockImplementation(file => {
    if (file === node || file === launcher) return file
    return actualFs.realpathSync(file)
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  processMocks.execFile.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})

function userUnit({ port = configPort, found = true, activeState = 'active', nodeArgs = [] as string[], mainPid = 0 } = {}) {
  processMocks.execFile.mockImplementationOnce((bin, args, options, cb) => {
    expect([bin, ...args.slice(0, 3)]).toEqual(['systemctl', '--user', 'show', unit])
    expect(options.env).toBe(env)
    const uid = process.getuid?.()
    const argv = [node, ...nodeArgs, launcher, 'gateway', '--port', port].join(' ')
    const output = [
      'LoadState=loaded', `ActiveState=${activeState}`, 'TimeoutStopUSec=5min 30s', 'TimeoutStartUSec=30s',
      `MainPID=${mainPid}`,
      `ControlGroup=/user.slice/user-${uid}.slice/user@${uid}.service/app.slice/${unit}`,
      `ExecStart={ path=${node} ; argv[]=${argv} ; ignore_errors=no ; }`,
    ].join('\n')
    cb(null, found ? output : 'LoadState=not-found', '')
  })
}

function scopeCheck() {
  processMocks.execFile.mockImplementationOnce((bin, args, _options, cb) => {
    expect([bin, ...args.slice(0, 2)]).toEqual(['systemctl', 'show', unit])
    cb(null, 'LoadState=not-found', '')
  })
}

function systemctl(action: string, error: Error | null = null, serviceState = 'ActiveState=active\nNRestarts=0') {
  processMocks.execFile.mockImplementationOnce((bin, args, options, cb) => {
    expect([bin, ...args.slice(0, 3)]).toEqual(['systemctl', '--user', action, unit])
    expect(options.env).toBe(env)
    if (action === 'restart') {
      expect(options.timeout).toBe(395_000)
      expect(fs.statSync(path.join(state, 'tmp')).mode & 0o777).toBe(0o755)
    }
    cb(error, action === 'show' ? serviceState : '', '')
  })
}

function cli(timeout: number) {
  processMocks.execFile.mockImplementationOnce((bin, args, options, cb) => {
    expect([bin, ...args]).toEqual(['openclaw', 'gateway', 'restart'])
    expect(options.timeout).toBe(timeout)
    cb(null, 'CLI restarted', '')
  })
}

describe('restartOpenclawGateway', () => {
  it.each([
    { nodeArgs: [] },
    { nodeArgs: ['--max-old-space-size=2048'] },
  ])('hardens temp roots and restarts the detected user unit with its stop budget, then waits for readiness (%j)', async ({ nodeArgs }) => {
    vi.useFakeTimers()
    userUnit({ nodeArgs })
    scopeCheck()
    systemctl('reset-failed')
    systemctl('restart')
    systemctl('show')
    systemctl('show')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const restart = restartOpenclawGateway({ timeout: 60_000, env })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(restart).resolves.toEqual({ stdout: `Restarted systemd service: ${unit}\n`, stderr: '' })
    expect(fetchMock).toHaveBeenLastCalledWith(new URL('http://127.0.0.1:18789/readyz'), expect.objectContaining({ method: 'HEAD' }))
    expect(processMocks.execFile.mock.calls.some(([bin]) => bin === 'openclaw')).toBe(false)
    expect(processMocks.execFile.mock.calls.some(([bin]) => bin === 'journalctl')).toBe(false)
  })

  it.each([
    { found: false, timeout: 60_000, useCli: false },
    { found: true, port: 18800, timeout: 395_000, useCli: false },
    { found: true, timeout: 395_000, useCli: true },
    { found: true, activeState: 'failed', timeout: 395_000, useCli: false },
    { found: true, nodeArgs: ['--require', '/opt/mcc-test/bootstrap.cjs'], timeout: 395_000, useCli: false },
  ])('falls back when detection fails, the definition needs repair, or CLI diagnostics are requested (%j)', async ({ timeout, useCli, ...unitOptions }) => {
    userUnit(unitOptions)
    cli(timeout)
    await expect(restartOpenclawGateway({ timeout: 60_000, env, useCli })).resolves.toMatchObject({ stdout: 'CLI restarted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the start limit if the verified unit fails between detection and restart', async () => {
    userUnit()
    scopeCheck()
    let startLimitHit = true
    processMocks.execFile
      .mockImplementationOnce((bin, args, _options, cb) => {
        expect([bin, ...args]).toEqual(['systemctl', '--user', 'reset-failed', unit])
        startLimitHit = false
        cb(null, '', '')
      })
      .mockImplementationOnce((bin, args, _options, cb) => {
        expect([bin, ...args]).toEqual(['systemctl', '--user', 'restart', unit])
        cb(startLimitHit ? new Error('start-limit-hit') : null, '', '')
      })
    systemctl('show')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await expect(restartOpenclawGateway({ timeout: 60_000, env })).resolves.toMatchObject({
      stdout: `Restarted systemd service: ${unit}\n`,
    })
  })

  it('surfaces a native restart failure and queries its journal without attempting a second restart', async () => {
    const error = Object.assign(new Error('systemctl restart failed'), { stderr: 'Permission denied' })
    userUnit()
    scopeCheck()
    systemctl('reset-failed')
    systemctl('restart', error)
    processMocks.execFile.mockImplementationOnce((bin, args, options, cb) => {
      expect([bin, ...args.slice(0, 3)]).toEqual(['journalctl', '--user', '-u', unit])
      expect(options.env).toBe(env)
      cb(null, '', '')
    })
    await expect(restartOpenclawGateway({ timeout: 60_000, env })).rejects.toBe(error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('detects a crash loop before the first readiness probe', async () => {
    userUnit()
    scopeCheck()
    systemctl('reset-failed')
    systemctl('restart')
    systemctl('show', null, 'ActiveState=active\nNRestarts=1')
    processMocks.execFile.mockImplementationOnce((bin, args, _options, cb) => {
      expect([bin, ...args.slice(0, 3)]).toEqual(['journalctl', '--user', '-u', unit])
      cb(null, '', '')
    })
    await expect(restartOpenclawGateway({ timeout: 60_000, env })).rejects.toThrow('was restarted by systemd 1 time(s)')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  function telegramWrite() {
    vi.useFakeTimers()
    fs.writeFileSync(path.join(state, 'openclaw.json'), JSON.stringify({
      gateway: { port: configPort },
      channels: { telegram: { enabled: true } },
    }))
    const configWrittenAt = Date.now()
    const entry = (offset: number, message: string) => JSON.stringify({
      MESSAGE: message, __REALTIME_TIMESTAMP: String((configWrittenAt + offset) * 1_000),
    })
    return {
      configWrittenAt,
      start: (offset: number) => entry(offset, '[telegram] [default] starting provider (@example)'),
      ingress: (offset: number) => entry(offset, '[telegram] [diag] isolated polling ingress started account=default'),
    }
  }

  function telegramJournal(...entries: string[]) {
    processMocks.execFile.mockImplementationOnce((bin, args, _options, cb) => {
      expect([bin, ...args.slice(0, 3)]).toEqual(['journalctl', '--user', '-u', unit])
      expect(args).toContain('_PID=123')
      cb(null, entries.join('\n'), '')
    })
  }

  it('dispatches the diagnostic CLI when Telegram ingress followed the newest start after the write', async () => {
    const { configWrittenAt, start, ingress } = telegramWrite()
    userUnit({ mainPid: 123 })
    telegramJournal(start(1), ingress(2))
    systemctl('show', null, 'MainPID=123')
    cli(395_000)

    await expect(restartOpenclawGateway({ timeout: 60_000, env, configWrittenAt, useCli: true }))
      .resolves.toMatchObject({ stdout: 'CLI restarted' })
  })

  it('holds the native restart until the newest start settles, even if an older ingress exists', async () => {
    const { configWrittenAt, start, ingress } = telegramWrite()
    userUnit({ mainPid: 123 })
    scopeCheck()
    telegramJournal(start(-20), ingress(-10), start(1))
    systemctl('show', null, 'LoadState=loaded\nActiveState=active\nMainPID=123')
    telegramJournal(start(-20), ingress(-10), start(1), ingress(2))
    systemctl('show', null, 'MainPID=123')
    systemctl('reset-failed')
    systemctl('restart')
    systemctl('show')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const restart = restartOpenclawGateway({ timeout: 60_000, env, configWrittenAt })
    await vi.advanceTimersByTimeAsync(499)
    expect(processMocks.execFile.mock.calls.some(([, args]) => args.includes('restart'))).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(restart).resolves.toMatchObject({ stdout: `Restarted systemd service: ${unit}\n` })
  })

  it('fails open at the deadline when there is no new ingress for the write', async () => {
    const { configWrittenAt, start, ingress } = telegramWrite()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    userUnit({ mainPid: 123 })
    for (let elapsed = 0; elapsed < 20_000; elapsed += 500) {
      if (elapsed > 0) systemctl('show', null, 'LoadState=loaded\nActiveState=active\nMainPID=123')
      telegramJournal(start(-20), ingress(-10))
    }
    cli(395_000)

    const restart = restartOpenclawGateway({ timeout: 60_000, env, configWrittenAt, useCli: true })
    await vi.advanceTimersByTimeAsync(19_999)
    expect(processMocks.execFile.mock.calls.some(([bin]) => bin === 'openclaw')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(restart).resolves.toMatchObject({ stdout: 'CLI restarted' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out after 20s'))
  })

  it('keeps polling when journalctl reports no startup events yet', async () => {
    const { configWrittenAt, start, ingress } = telegramWrite()
    userUnit({ mainPid: 123 })
    processMocks.execFile.mockImplementationOnce((bin, args, _options, cb) => {
      expect(bin).toBe('journalctl')
      expect(args).toContain('_PID=123')
      cb(Object.assign(new Error('no matches'), { code: 1, stdout: '', stderr: '' }), '', '')
    })
    systemctl('show', null, 'LoadState=loaded\nActiveState=active\nMainPID=123')
    telegramJournal(start(1), ingress(2))
    systemctl('show', null, 'MainPID=123')
    cli(395_000)

    const restart = restartOpenclawGateway({ timeout: 60_000, env, configWrittenAt, useCli: true })
    await vi.advanceTimersByTimeAsync(499)
    expect(processMocks.execFile.mock.calls.some(([bin]) => bin === 'openclaw')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(restart).resolves.toMatchObject({ stdout: 'CLI restarted' })
  })

  it('skips the barrier when Telegram is not configured', async () => {
    userUnit({ mainPid: 123 })
    cli(395_000)
    await expect(restartOpenclawGateway({ timeout: 60_000, env, configWrittenAt: Date.now(), useCli: true }))
      .resolves.toMatchObject({ stdout: 'CLI restarted' })
    expect(processMocks.execFile.mock.calls.some(([bin]) => bin === 'journalctl')).toBe(false)
  })
})
