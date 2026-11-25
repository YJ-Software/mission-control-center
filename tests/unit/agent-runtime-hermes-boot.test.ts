import { EventEmitter } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { processMocks } from './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'
import native from './fixtures/hermes-0.21.5-reads.json'
import { resolveHermesConfig } from '@/lib/agent-runtime/hermes-config'

const m = vi.hoisted(() => ({
  installed: vi.fn(), listens: vi.fn(), upstream: vi.fn(), bootstrap: vi.fn(),
  initDb: vi.fn(), dbSelect: vi.fn(), shutdown: vi.fn(), wiki: vi.fn(),
  tunnel: vi.fn(), cs: vi.fn(), legacyRecovery: vi.fn(), schedule: vi.fn(), opencli: vi.fn(),
  webSockets: [] as EventEmitter[],
}))
vi.mock('next', () => ({ default: () => ({ prepare: async () => {}, getRequestHandler: () => vi.fn() }) }))
vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }))
vi.mock('http', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    createServer: () => Object.assign(new EventEmitter(), {
      listen: (port: number, host: string, ready: () => void) => { m.listens(port, host); ready() },
    }),
  }
})
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    WebSocket: class {
      static readonly OPEN = 1
      constructor(...args: unknown[]) { m.upstream(...args) }
    },
    WebSocketServer: class extends EventEmitter {
      readonly clients = new Set()
      constructor() { super(); m.webSockets.push(this) }
    },
  }
})
vi.mock('@/lib/agent-runtime/bootstrap', () => ({ bootstrapEnvLocal: m.bootstrap }))
vi.mock('@/lib/db', () => ({ initDb: m.initDb, db: { select: m.dbSelect }, closeDb: vi.fn() }))
vi.mock('@/lib/shutdown', () => ({ createGracefulShutdown: () => m.shutdown, trackConnections: () => new Set() }))
vi.mock('@/lib/terminal/session-manager', () => ({ TerminalSessionManager: class {} }))
vi.mock('@/lib/morning-report/tunnel', () => ({ startTunnel: m.tunnel, stopTunnel: vi.fn() }))
vi.mock('@/lib/second-brain/wiki/watcher', () => ({ startWikiWatcher: m.wiki }))
vi.mock('@/lib/customer-service/cs-storage-scheduler', () => ({ startCsStorageScheduler: m.cs }))
vi.mock('@/lib/browser/opencli-autoload-repair', () => ({ ensureOpencliAutoload: m.opencli }))
vi.mock('@/lib/backup/scheduler', () => ({ startBackupScheduler: m.schedule }))
vi.mock('@/lib/openclaw/update-memory-guard', () => ({ recoverGatewayStoppedForUpgrade: m.legacyRecovery }))
vi.mock('@/lib/upgrade/manager', () => ({ getInstallInfo: m.installed }))
vi.mock('@/lib/upgrade/ensure-log-rotation', () => ({ ensureLogRotation: vi.fn() }))
vi.mock('@/lib/upgrade/ensure-service-unit', () => ({ ensureServiceUnit: vi.fn() }))
vi.mock('@/lib/system-update/dpkg-boot-check', () => ({ runDpkgBootCheck: vi.fn() }))

let state: ReturnType<typeof stubHermesHome>

beforeEach(() => {
  state = stubHermesHome()
  vi.stubEnv('PORT', '0')
  vi.stubEnv('HOST', '127.0.0.1')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  process.removeListener('SIGINT', m.shutdown)
  process.removeListener('SIGTERM', m.shutdown)
  delete (globalThis as { __gatewayRpc?: unknown }).__gatewayRpc
  delete (globalThis as { __terminalManager?: unknown }).__terminalManager
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  state.cleanup()
})

it('boots Hermes before accepting browser RPC and skips OpenClaw-only boot work', async () => {
  const bootOrder: string[] = []
  const authHeaders: Array<string | null> = []
  const legacyKey = 'fixture-legacy-override-0123456789'
  vi.stubEnv('HERMES_API_KEY', legacyKey)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let gatewayKey: string
  m.bootstrap.mockReturnValue(false)
  m.listens.mockImplementation(() => bootOrder.push('listen'))
  processMocks.execFile.mockImplementationOnce((cmd, args, opts, done) => {
    expect([cmd, ...args]).toEqual(['systemctl', '--user', 'restart', 'hermes-gateway.service'])
    expect(opts.env.HOME).toBe(state.home)
    gatewayKey = resolveHermesConfig().apiKey
    expect(gatewayKey).toMatch(/^[a-f0-9]{64}$/)
    bootOrder.push('restart')
    done(null, '', '')
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'http://127.0.0.1:8642/health') {
      bootOrder.push('health')
      return Response.json(native.health)
    }
    if (url === 'http://127.0.0.1:8642/health/detailed') {
      bootOrder.push('detailed')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${gatewayKey}`)
      return Response.json(native.detailedHealth)
    }
    authHeaders.push(new Headers(init?.headers).get('Authorization'))
    if (url === 'http://127.0.0.1:8642/v1/models') return Response.json({ data: [] })
    expect(url).toBe('http://127.0.0.1:8642/api/sessions?limit=200&offset=0')
    return Response.json(native.sessions)
  }))

  await import('../../server')
  await vi.waitFor(() => expect(m.listens).toHaveBeenCalledWith(0, '127.0.0.1'))
  await vi.waitFor(() => expect(m.schedule).toHaveBeenCalledWith({ skipLegacyCron: true }))
  await vi.waitFor(() => expect(m.installed).toHaveBeenCalledOnce())
  expect(bootOrder).toEqual(['restart', 'health', 'detailed', 'listen'])
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Using the Hermes .env key'))
  expect(JSON.stringify(warn.mock.calls)).not.toContain(legacyKey)
  expect(JSON.stringify(warn.mock.calls)).not.toContain(gatewayKey!)
  expect(existsSync(join(state.home, '.mission-control', 'gateway-device-key.pem'))).toBe(false)
  expect(m.initDb).toHaveBeenCalledOnce()
  for (const skipped of [m.upstream, m.wiki, m.dbSelect, m.tunnel, m.cs, m.legacyRecovery, m.opencli]) {
    expect(skipped).not.toHaveBeenCalled()
  }
  const { __gatewayRpc } = globalThis as { __gatewayRpc?: (method: string) => Promise<unknown> }
  await expect(__gatewayRpc!('cron.list')).rejects.toThrow('not supported on Hermes backend')

  const ws = Object.assign(new EventEmitter(), { send: vi.fn() })
  m.webSockets[0].emit('connection', ws, { socket: { remoteAddress: 'fixture' } })
  expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ payload: { runtime: 'hermes' } })
  const file = join(state.hermes, '.env')
  ws.emit('message', JSON.stringify({ type: 'req', id: 'req-0', method: 'sessions.list' }))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2))
  expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'res', id: 'req-0', ok: true })
  expect(authHeaders).toEqual([`Bearer ${gatewayKey!}`])

  const rotatedKey = 'fixture-new-key-0123456789'
  writeFileSync(file, `API_SERVER_KEY=${rotatedKey}\n`)
  ws.emit('message', JSON.stringify({ type: 'req', id: 'req-1', method: 'sessions.list' }))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(3))
  expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'res', id: 'req-1', ok: true })
  expect(authHeaders.at(-1)).toBe(`Bearer ${rotatedKey}`)
  ws.emit('message', JSON.stringify({ type: 'req', id: 'req-2', method: 'models.list' }))
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(4))
  expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'res', id: 'req-2', ok: true, payload: { models: [] } })
  expect(authHeaders).toEqual([`Bearer ${gatewayKey!}`, `Bearer ${rotatedKey}`, `Bearer ${rotatedKey}`])
})
