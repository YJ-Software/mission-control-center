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

function userUnit({ port = configPort, found = true, activeState = 'active' } = {}) {
  processMocks.execFile.mockImplementationOnce((bin, args, options, cb) => {
    expect([bin, ...args.slice(0, 3)]).toEqual(['systemctl', '--user', 'show', unit])
    expect(options.env).toBe(env)
    const uid = process.getuid?.()
    const output = [
      'LoadState=loaded', `ActiveState=${activeState}`, 'TimeoutStopUSec=5min 30s', 'TimeoutStartUSec=30s',
      `ControlGroup=/user.slice/user-${uid}.slice/user@${uid}.service/app.slice/${unit}`,
      `ExecStart={ path=${node} ; argv[]=${node} ${launcher} gateway --port ${port} ; ignore_errors=no ; }`,
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
  it('hardens temp roots and restarts the detected user unit with its stop budget, then waits for readiness', async () => {
    vi.useFakeTimers()
    userUnit()
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
  })

  it.each([
    { found: false, timeout: 60_000, useCli: false },
    { found: true, port: 18800, timeout: 395_000, useCli: false },
    { found: true, timeout: 395_000, useCli: true },
    { found: true, activeState: 'failed', timeout: 395_000, useCli: false },
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
})
