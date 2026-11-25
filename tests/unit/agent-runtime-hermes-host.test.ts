import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { processMocks, gatewayMock } from './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'
import { getDefaultSlashCommands } from '@/components/chat/chat-slash-menu'
import { capabilitiesFor, supportsPage } from '@/lib/agent-runtime/capabilities'
import { bootstrapEnvLocal } from '@/lib/agent-runtime/bootstrap'
import { agentRuntimeKind, unsupportedGatewayRpc } from '@/lib/agent-runtime/selection'
import { resolveHermesConfig } from '@/lib/agent-runtime/hermes-config'
import { getHermesVersion, provisionHermesApi, waitForHermesHealth } from '@/lib/agent-runtime/hermes-host'
import { getAgentRuntime, resetAgentRuntime } from '@/lib/agent-runtime'
import type { JobSpec } from '@/lib/jobs/runner'
import native from './fixtures/hermes-0.21.5-reads.json'

const m = vi.hoisted(() => ({
  job: vi.fn(),
  openclawVersion: vi.fn(),
  backupBusy: vi.fn(),
}))
vi.mock('@/lib/jobs/runner', () => ({ startJob: m.job }))
vi.mock('@/lib/backup/lock', () => ({ isBackupOrRestoreBusy: m.backupBusy }))
vi.mock('@/lib/openclaw/installed-version', () => ({ readInstalledOpenclawVersion: m.openclawVersion }))
vi.mock('@/lib/version', () => ({ getVersionInfo: () => ({ version: '0.4.10', mccVersion: '0.4.10', commit: null, buildTime: 'time' }) }))

let state: ReturnType<typeof stubHermesHome>
let dotenv: string
const fixtureKey = 'fixture-key-0123456789'

beforeEach(() => {
  state = stubHermesHome()
  dotenv = join(state.hermes, '.env')
  processMocks.execFile.mockClear()
  processMocks.execFileSync.mockClear()
  m.job.mockReset().mockReturnValue({ id: 'fixture-job' })
  m.openclawVersion.mockClear()
  m.backupBusy.mockReset().mockReturnValue(false)
  gatewayMock.mockClear()
})

afterEach(() => {
  resetAgentRuntime()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  state.cleanup()
})

describe('Hermes selection, provisioning and health', () => {
  it('defaults to OpenClaw and accepts explicit Hermes with localhost and native dotenv defaults', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', undefined)
    expect(agentRuntimeKind()).toBe('openclaw')
    vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
    vi.stubEnv('HERMES_HOME', undefined)
    writeFileSync(dotenv, `export API_SERVER_KEY='${fixtureKey}' # fixture\n`)
    expect(resolveHermesConfig()).toEqual({ baseUrl: 'http://127.0.0.1:8642', apiKey: fixtureKey })
    vi.stubEnv('HERMES_API_URL', 'http://fixture.invalid:8642/')
    vi.stubEnv('HERMES_API_KEY', 'fixture-override-0123456789')
    expect(resolveHermesConfig()).toEqual({ baseUrl: 'http://fixture.invalid:8642', apiKey: fixtureKey })
  })

  it('refreshes the cached runtime when native key contents rotate', async () => {
    const seen: Array<string | null> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('Authorization'))
      return Response.json(native.sessions)
    }))
    writeFileSync(dotenv, `API_SERVER_KEY=${fixtureKey}\n`)
    const before = getAgentRuntime()
    expect(getAgentRuntime()).toBe(before)
    await before.listSessions()
    writeFileSync(dotenv, 'API_SERVER_KEY=fixture-rotated-0123456789\n')
    const after = getAgentRuntime()
    expect(after).not.toBe(before)
    await after.listSessions()
    expect(seen).toEqual([`Bearer ${fixtureKey}`, 'Bearer fixture-rotated-0123456789'])
  })

  it.each([undefined, 'API_SERVER_KEY=short\n', 'API_SERVER_KEY=your-api-key-here\n'])(
    'repairs an unusable native dotenv and waits for HTTP readiness',
    async (previous) => {
      if (previous !== undefined) writeFileSync(dotenv, previous)
      const order: string[] = []
      processMocks.execFile.mockImplementationOnce((cmd, args, options, done) => {
        expect(cmd).toBe('systemctl')
        expect(args).toEqual(['--user', 'restart', 'hermes-gateway.service'])
        expect(options.env.HOME).toBe(state.home)
        expect(options.env.HERMES_HOME).toBe(state.hermes)
        expect(resolveHermesConfig().apiKey).toMatch(/^[0-9a-f]{64}$/)
        order.push('restart')
        done(null, '', '')
      })
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === 'http://127.0.0.1:8642/health') {
          order.push('health')
          return Response.json(native.health)
        }
        expect(url).toBe('http://127.0.0.1:8642/health/detailed')
        expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${resolveHermesConfig().apiKey}`)
        order.push('detailed')
        return Response.json(native.detailedHealth)
      }))
      await provisionHermesApi()
      expect(statSync(dotenv).mode & 0o777).toBe(0o600)
      await provisionHermesApi()
      expect(order).toEqual(['restart', 'health', 'detailed', 'detailed'])
      expect(processMocks.execFile).toHaveBeenCalledTimes(1)
    },
  )

  it('retries an unsuccessful restart on the next boot with the same provisioned key', async () => {
    const order: string[] = []
    const unexpectedFetch = vi.fn(async () => { throw new Error('readiness called before restart') })
    vi.stubGlobal('fetch', unexpectedFetch)
    processMocks.execFile
      .mockImplementationOnce((_cmd, _args, _opts, done) => {
        order.push('failed restart')
        done(Object.assign(new Error('fixture failure'), { code: 1 }), '', '')
      })
      .mockImplementationOnce((cmd, args, _opts, done) => {
        expect([cmd, ...args]).toEqual(['systemctl', '--user', 'restart', 'hermes-gateway.service'])
        order.push('restart')
        done(null, '', '')
      })
    await expect(provisionHermesApi()).rejects.toThrow('Hermes gateway restart failed')
    expect(unexpectedFetch).not.toHaveBeenCalled()
    const persisted = readFileSync(dotenv, 'utf8')
    const apiKey = resolveHermesConfig().apiKey
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) {
        order.push('health')
        return Response.json(native.health)
      }
      expect(url).toBe('http://127.0.0.1:8642/health/detailed')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${apiKey}`)
      order.push('detailed')
      return order.includes('restart') ? Response.json(native.detailedHealth) : new Response(null, { status: 401 })
    }))
    await provisionHermesApi()
    expect(order).toEqual(['failed restart', 'detailed', 'restart', 'health', 'detailed'])
    expect(readFileSync(dotenv, 'utf8')).toBe(persisted)
    expect(processMocks.execFile).toHaveBeenCalledTimes(2)
  })

  it.each([
    'PROVIDER="first\nAPI_SERVER_KEY=not-a-real-assignment\nlast"\n',
    'PROVIDER=\x60first\nAPI_SERVER_KEY=not-a-real-assignment\nlast\x60\n',
    "'PROVIDER'=\"first\r\nAPI_SERVER_KEY=not-a-real-assignment\r\nlast\"",
    'PROVIDER="first\\\"\nAPI_SERVER_KEY=not-a-real-assignment\nlast"\n',
  ])('appends a top-level key without modifying the multiline provider value %j', async (previous) => {
    writeFileSync(join(state.hermes, 'config.yaml'), 'gateway: { api_server: { enabled: false } }\n')
    writeFileSync(dotenv, previous)
    await provisionHermesApi(vi.fn())
    const key = resolveHermesConfig().apiKey
    const nl = previous.includes('\r\n') ? '\r\n' : '\n'
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(readFileSync(dotenv, 'utf8')).toBe(`${previous}${previous.endsWith('\n') ? '' : nl}API_SERVER_KEY=${key}${nl}`)
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })

  it('preserves other dotenv lines, prefixes, comments, and CRLF while honoring the YAML disable', async () => {
    const yaml = ['gateway:', '  platforms:', '    api_server:', '      enabled: true',
      'platforms:', '  api_server: { enabled: false }', '# preserve this', ''].join('\n')
    const config = join(state.hermes, 'config.yaml')
    writeFileSync(config, yaml)
    const previous = '# fixture\r\nPROVIDER="test\r\nAPI_SERVER_KEY=leave-in-quoted-value\r\nbody"\r\n\texport API_SERVER_KEY= # keep\r\nOTHER=fixture\r\n'
    writeFileSync(dotenv, previous, { mode: 0o664 })
    const warn = vi.fn()
    await provisionHermesApi(warn)
    const key = resolveHermesConfig().apiKey
    expect(readFileSync(dotenv, 'utf8')).toBe(previous.replace('= # keep', `= ${key} # keep`))
    expect(readFileSync(config, 'utf8')).toBe(yaml)
    expect(statSync(dotenv).mode & 0o777).toBe(0o600)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('api_server is explicitly disabled'))
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })

  it('loads the native reported version with a configurable local metadata fallback', async () => {
    const install = join(state.home, 'hermes-checkout')
    mkdirSync(join(install, 'hermes_cli'), { recursive: true })
    writeFileSync(join(install, 'hermes_cli', '__init__.py'), '__version__ = "0.21.4"\n')
    vi.stubEnv('HERMES_INSTALL_DIR', install)
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(native.health)).mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getHermesVersion()).resolves.toBe('0.21.5')
    await expect(getHermesVersion()).resolves.toBe('0.21.4')
  })

  it('bounds readiness and does not accept a successful response with the wrong authenticated endpoint status', async () => {
    writeFileSync(dotenv, `API_SERVER_KEY=${fixtureKey}\n`)
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/detailed') ? new Response(null, { status: 401 }) : Response.json(native.health))
    vi.stubGlobal('fetch', fetchMock)
    await expect(waitForHermesHealth({ detailed: true, timeoutMs: 15 })).rejects.toThrow('/health and /health/detailed')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/health/detailed'), expect.objectContaining({
      headers: { Authorization: `Bearer ${fixtureKey}` },
    }))
  })
})

describe('Hermes dashboard capabilities and services', () => {
  it('blocks OpenClaw boot credentials and RPC while keeping a stable synthetic chat agent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const findToken = vi.fn(() => { throw new Error('OpenClaw config read') })
    expect(bootstrapEnvLocal(state.home, capabilitiesFor('hermes'), findToken)).toBe(true)
    expect(findToken).not.toHaveBeenCalled()
    expect(readFileSync(join(state.home, '.env.local'), 'utf8')).toMatch(/^MCC_AGENT_RUNTIME=hermes$/m)
    expect(readFileSync(join(state.home, '.env.local'), 'utf8')).not.toContain('OPENCLAW_')
    expect(statSync(join(state.home, '.env.local')).mode & 0o777).toBe(0o600)
    await expect(unsupportedGatewayRpc()).rejects.toThrow('not supported on Hermes backend')
    const { GET } = await import('@/app/api/agents/route')
    expect(await (await GET()).json()).toMatchObject({ agents: [{ id: 'hermes-agent', name: 'Hermes', defaultSessionKey: 'mcc-main' }] })
    expect(gatewayMock).not.toHaveBeenCalled()
  })

  it('shares a capability map for navigation and direct routes and reports it in /api/health', async () => {
    const { GET } = await import('@/app/api/health/route')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(native.health)))
    const hermes = capabilitiesFor('hermes')
    const openclaw = capabilitiesFor('openclaw')
    for (const page of ['/agents', '/customer-service', '/second-brain', '/cron-jobs', '/morning-report', '/llm-auth', '/live-feed', '/setup']) {
      expect(supportsPage(hermes, page)).toBe(false)
      expect(supportsPage(hermes, `${page}/subpage`)).toBe(false)
      expect(supportsPage(openclaw, page)).toBe(true)
    }
    for (const page of ['/chat', '/talk', '/dashboard', '/sessions', '/costs', '/backup']) {
      expect(supportsPage(hermes, page)).toBe(true)
    }
    expect(getDefaultSlashCommands((key) => key, hermes.modelPicker).map(({ name }) => name)).not.toContain('model')
    expect(getDefaultSlashCommands((key) => key, openclaw.modelPicker).map(({ name }) => name)).toContain('model')
    expect(hermes.modelPicker).toBe(false)
    expect(openclaw.modelPicker).toBe(true)
    expect(hermes.interactivePrompts).toEqual({ approvals: true, questions: false })
    expect(await (await GET()).json()).toMatchObject({
      status: 'ok', mccVersion: '0.4.10', openclawVersion: null,
      backend: { kind: 'hermes', version: native.health.version, capabilities: hermes },
    })
  })

  it('uses the current user manager and omits OpenClaw service/version detection', async () => {
    processMocks.execFile.mockImplementationOnce((cmd, args, opts, done) => {
      expect([cmd, ...args]).toEqual(['systemctl', '--user', 'show', '-p', 'LoadState', '-p', 'ActiveState', 'hermes-gateway.service'])
      expect(opts.env.HOME).toBe(state.home)
      done(null, 'LoadState=loaded\nActiveState=active\n', '')
    })
    processMocks.execFileSync
      .mockImplementationOnce((cmd, args) => {
        expect([cmd, ...args]).toEqual(['which', 'imunify-antivirus'])
        throw new Error('missing')
      })
      .mockImplementationOnce((cmd, args) => {
        expect([cmd, ...args]).toEqual(['which', 'opencli'])
        throw new Error('missing')
      })
      .mockImplementationOnce((cmd, args) => {
        expect([cmd, ...args]).toEqual(['systemctl', 'is-active', '--quiet', 'tailscaled'])
        return ''
      })
      .mockImplementationOnce((cmd, args) => {
        expect([cmd, ...args]).toEqual(['tailscale', 'status', '--json'])
        return ''
      })
      .mockImplementationOnce((cmd, args) => {
        expect([cmd, ...args]).toEqual(['opencli', '--version'])
        return ''
      })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(native.health)))
    const { GET } = await import('@/app/api/services/route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      openclawVersion: null,
      services: expect.arrayContaining([{
        name: 'hermes-gateway.service', active: true, version: '0.21.5', restartAction: 'restart-hermes',
      }]),
    })
    expect(m.openclawVersion).not.toHaveBeenCalled()
  })

  it('queues a restart job with the Hermes user unit and checks HTTP after restart', async () => {
    const { POST } = await import('@/app/api/action/route')
    const send = (action: string) => POST(new NextRequest('http://fixture.invalid/api/action', { method: 'POST', body: JSON.stringify({ action }) }))
    expect((await send('restart-openclaw')).status).toBe(400)
    expect((await send('update-openclaw')).status).toBe(400)
    expect((await send('update-hermes')).status).toBe(400)
    m.backupBusy.mockReturnValueOnce(true)
    expect((await send('restart-hermes')).status).toBe(409)
    expect(m.job).not.toHaveBeenCalled()
    expect(await (await send('restart-hermes')).json()).toMatchObject({ success: true, jobId: 'fixture-job' })
    const spec = m.job.mock.calls[0][0] as JobSpec
    expect(spec.kind).toBe('restart-hermes')
    const order: string[] = []
    processMocks.execFile.mockImplementationOnce((cmd, args, options, done) => {
      expect([cmd, ...args]).toEqual(['systemctl', '--user', 'restart', 'hermes-gateway.service'])
      expect(options.env.HOME).toBe(state.home)
      order.push('restart')
      done(null, '', '')
    })
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(url).toBe('http://127.0.0.1:8642/health')
      order.push('health')
      return Response.json(native.health)
    }))
    for (const phase of spec.phases) {
      await expect(phase.inline!(vi.fn(), { setExpectedVersion() {}, setExtra() {} })).resolves.toBe(0)
    }
    expect(order).toEqual(['restart', 'health'])
  })
})
