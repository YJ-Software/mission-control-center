import { gatewayMock, processMocks } from './helpers/offline-owner-mocks'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGlobalDefaults, listAvailable, readAgentsConfig } from '@/lib/openclaw/models-config'
import { buildPasteApiKeyJob, realPluginProbe } from '@/lib/openclaw/auth-jobs'
import { getStatus as gateStatus } from '@/lib/customer-service/business-hours-gate'
import { invalidateStoredProfiles, listStoredProfiles } from '@/lib/openclaw/auth-profiles'
import { isGatewayRpcUnavailable } from '@/lib/openclaw/rpc-fallback'

const fixture = vi.hoisted(() => ({ config: {} as any }))
vi.mock('fs', async (orig) => ({
  ...await orig<typeof import('fs')>(),
  existsSync: () => true,
  readFileSync: (file: string) => {
    if (!file.endsWith('openclaw.json')) throw new Error('Unexpected file read')
    return JSON.stringify(fixture.config)
  },
}))
vi.mock('@/lib/server-env', () => ({ getServerEnv: () => ({}) }))

const refuseSpawn = processMocks.spawn.getMockImplementation()!
const refuseExec = processMocks.execFile.getMockImplementation()!
const unavailable = [
  'Gateway RPC not available (server.ts not initialized)',
  'Gateway not linked', 'Gateway not initialised', 'Gateway WebSocket not connected',
  'Gateway disconnected', 'Gateway connection closed',
  'RPC timeout for config.get', 'unknown method: config.get',
  'method not found', 'method not supported', 'unsupported method',
]

beforeEach(() => {
  gatewayMock.mockReset()
  processMocks.spawn.mockReset().mockImplementation(refuseSpawn)
  processMocks.execFile.mockReset().mockImplementation(refuseExec)
  fixture.config = {}
  invalidateStoredProfiles()
})

function spawnOutput(expectedArgs: string[], stdout: string, code = 0, stderr = '') {
  processMocks.spawn.mockImplementation((bin, args) => {
    expect(bin).toBe('openclaw')
    expect(args.filter((v: string) => !['--log-level', 'silent', '--no-color'].includes(v))).toEqual(expectedArgs)
    const child = new EventEmitter() as any
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.kill = vi.fn()
    queueMicrotask(() => {
      child.stdout.emit('data', stdout)
      child.stderr.emit('data', stderr)
      child.emit('close', code)
    })
    return child
  })
}

const agents = { entries: { main: { model: { primary: 'test/model' }, tools: { token: '__OPENCLAW_REDACTED__' } } } }
const defaults = { primary: 'test/global', fallbacks: ['test/backup'] }
const snapshot = { valid: true, config: { agents: { ...agents, defaults: { model: defaults } } }, raw: 'must not be used', parsed: { agents: 'must not be used' } }

const configReads = [
  { name: 'agents config', read: readAgentsConfig, path: 'agents', value: snapshot.config.agents },
  { name: 'global defaults', read: getGlobalDefaults, path: 'agents.defaults.model', value: defaults },
]

for (const read of configReads) describe(read.name, () => {
  it('selects the CLI-equivalent redacted config subtree from the RPC snapshot', async () => {
    gatewayMock.mockResolvedValue(snapshot)
    expect(await read.read()).toEqual(read.value)
    expect(gatewayMock).toHaveBeenCalledWith('config.get', {})
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each(unavailable)('uses the existing limited CLI when %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    spawnOutput(['config', 'get', read.path], JSON.stringify(read.value))
    expect(await read.read()).toEqual(read.value)
    expect(processMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects a permission error, like the previous failed CLI read, without CLI retry', async () => {
    gatewayMock.mockRejectedValue(new Error('permission denied'))
    await expect(read.read()).rejects.toThrow('permission denied')
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each([{ valid: false, config: {} }, {}, null])('rejects invalid snapshots without CLI or raw-config exposure: %j', async (value) => {
    gatewayMock.mockResolvedValue(value)
    await expect(read.read()).rejects.toThrow('config get failed')
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('preserves CLI failures on fallback', async () => {
    gatewayMock.mockRejectedValue(new Error('unknown method'))
    spawnOutput(['config', 'get', read.path], '', 124, 'timed out')
    await expect(read.read()).rejects.toThrow('config get failed (124): timed out')
  })
})

it('keeps empty agents/defaults and scalar model defaults in the existing shapes', async () => {
  gatewayMock.mockResolvedValue({ valid: true, config: {} })
  expect(await readAgentsConfig()).toEqual({})
  expect(await getGlobalDefaults()).toEqual({ primary: null, fallbacks: [] })
  gatewayMock.mockResolvedValue({ valid: true, config: { agents: { defaults: { model: 'test/scalar' } } } })
  expect(await getGlobalDefaults()).toEqual({ primary: null, fallbacks: [] })
})

describe('available models', () => {
  it('uses the CLI params and toCliModelRow projection, excluding RPC-only fields', async () => {
    gatewayMock.mockResolvedValue({ models: [
      { provider: 'test', id: 'model', name: 'Model', input: ['text', 'image'], contextWindow: 32000, contextTokens: 16000,
        local: false, available: true, tags: ['default', 'alias:quick'], alias: 'quick', routes: ['private'] },
      { provider: ' test ', id: 'TEST/other ', name: 'Other' },
      { provider: '', id: 'plain', name: 'Plain', input: [] },
    ] })
    expect(await listAvailable('sales')).toEqual([
      { key: 'test/model', name: 'Model', input: 'text+image', contextWindow: 32000, contextTokens: 16000, local: false, available: true, tags: ['default', 'alias:quick'] },
      { key: 'TEST/other', name: 'Other', input: '-', contextWindow: null, local: null, available: null, tags: [] },
      { key: 'plain', name: 'Plain', input: '-', contextWindow: null, local: null, available: null, tags: [] },
    ])
    expect(gatewayMock).toHaveBeenCalledWith('models.list', { agentId: 'sales', view: 'default', includeDetails: true })
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each(unavailable)('falls back when %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    const models = [{ key: 'test/old', missing: true }]
    spawnOutput(['models', '--agent', 'main', 'list', '--json'], JSON.stringify({ models }))
    expect(await listAvailable('main')).toEqual(models)
  })

  it('rejects business errors without spawning, as with a nonzero CLI read', async () => {
    gatewayMock.mockRejectedValue(new Error('invalid agent id'))
    await expect(listAvailable('main')).rejects.toThrow('invalid agent id')
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects malformed successful responses without CLI retry', async () => {
    gatewayMock.mockResolvedValue({ providers: [] })
    await expect(listAvailable('main')).rejects.toThrow('invalid gateway response')
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('preserves fallback CLI exit errors', async () => {
    gatewayMock.mockRejectedValue(new Error('unknown method'))
    spawnOutput(['models', '--agent', 'main', 'list', '--json'], '', 1, 'failed')
    await expect(listAvailable('main')).rejects.toThrow('models list failed (1): failed')
  })
})

function registerProvider() {
  const job = buildPasteApiKeyJob({ provider: 'kimi', agent: 'main', apiKey: 'test-only', triggeredBy: 'api' })
  return job.phases[3].inline!(vi.fn(), {} as any)
}

describe('provider config existence during auth', () => {
  it('checks existence in the resolved config without returning or logging provider secrets', async () => {
    gatewayMock.mockResolvedValue({ valid: true, config: { models: { providers: { kimi: { apiKey: '__OPENCLAW_REDACTED__' } } } } })
    expect(await registerProvider()).toBe(0)
    expect(gatewayMock).toHaveBeenCalledWith('config.get', {})
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each(unavailable)('falls back when %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    spawnOutput(['config', 'get', 'models.providers.kimi'], '{}')
    expect(await registerProvider()).toBe(0)
    expect(processMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it.each(['permission denied', 'invalid config'])('keeps failed-read semantics (seed template) for %s, without CLI read retry', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    // The existing auth phase treats a failed config read as absent and seeds its template.
    spawnOutput(['config', 'set', 'models.providers.kimi', expect.any(String), '--strict-json'], '')
    expect(await registerProvider()).toBe(0)
    expect(processMocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('seeds the template when RPC confirms the path is absent', async () => {
    gatewayMock.mockResolvedValue({ valid: true, config: {} })
    spawnOutput(['config', 'set', 'models.providers.kimi', expect.any(String), '--strict-json'], '')
    expect(await registerProvider()).toBe(0)
    expect(processMocks.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('plugin probes', () => {
  it('counts only installed IDs, retaining disabled/error plugins just as the CLI inventory does', async () => {
    gatewayMock.mockResolvedValue({ plugins: [
      { id: 'kimi', installed: false }, { id: 'disabled', installed: true, enabled: false },
      { id: 'broken', installed: true, state: 'error' }, { id: 'kimi-other', installed: true },
    ] })
    expect(await realPluginProbe.listed('kimi')).toBe(false)
    expect(await realPluginProbe.listed('disabled')).toBe(true)
    expect(await realPluginProbe.listed('broken')).toBe(true)
    expect(gatewayMock).toHaveBeenCalledWith('plugins.list', {})
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each([{ results: [] }, { results: [{ package: { name: '@openclaw/test' } }] }])('maps plugin search results to CLI Install-line existence: %j', async ({ results }) => {
    gatewayMock.mockResolvedValue({ results })
    expect(await realPluginProbe.available('test')).toBe(results.length > 0)
    expect(gatewayMock).toHaveBeenCalledWith('plugins.search', { query: 'test' })
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  for (const probe of [
    { name: 'listed', call: realPluginProbe.listed, args: ['plugins', 'list'], stdout: '| kimi |' },
    { name: 'available', call: realPluginProbe.available, args: ['plugins', 'search', 'kimi'], stdout: 'Install: openclaw plugins install clawhub:kimi' },
  ]) describe(probe.name, () => {
    it.each(unavailable)('falls back when %s', async (message) => {
      gatewayMock.mockRejectedValue(new Error(message))
      spawnOutput(probe.args, probe.stdout)
      expect(await probe.call('kimi')).toBe(true)
    })

    it('returns false on permission failure, matching a failed CLI probe, without retry', async () => {
      gatewayMock.mockRejectedValue(new Error('permission denied'))
      expect(await probe.call('kimi')).toBe(false)
      expect(processMocks.spawn).not.toHaveBeenCalled()
    })

    it('returns false on malformed responses without retry', async () => {
      gatewayMock.mockResolvedValue({})
      expect(await probe.call('kimi')).toBe(false)
      expect(processMocks.spawn).not.toHaveBeenCalled()
    })
  })
})

describe('customer-service plugin inventory poll', () => {
  it('maps only installed plugins to the existing two installed booleans', async () => {
    gatewayMock.mockResolvedValue({ plugins: [
      { id: 'business-hours-gate', installed: true }, { id: 'customer-id-injector', installed: false },
    ] })
    expect(await gateStatus()).toMatchObject({ installed: true, idInjector: { installed: false } })
    expect(gatewayMock).toHaveBeenCalledWith('plugins.list', {})
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })

  it.each(unavailable)('uses the limited CLI when %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    processMocks.execFile.mockImplementation((bin, args, opts, callback) => {
      expect(bin).toBe('openclaw')
      expect(args).toEqual(['plugins', 'list', '--json'])
      expect(opts.timeout).toBe(10000)
      callback(null, JSON.stringify({ plugins: [{ id: 'business-hours-gate' }, { id: 'customer-id-injector' }] }), '')
    })
    expect(await gateStatus()).toMatchObject({ installed: true, idInjector: { installed: true } })
    expect(processMocks.execFile).toHaveBeenCalledTimes(1)
  })

  it('retains config-enabled estimates on RPC permission failure, like previous CLI failure', async () => {
    fixture.config = { plugins: { entries: { 'business-hours-gate': { enabled: true } } } }
    gatewayMock.mockRejectedValue(new Error('permission denied'))
    expect(await gateStatus()).toMatchObject({ installed: true, idInjector: { installed: false } })
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
})

it('keeps stored auth status unknown on permission errors without a CLI retry', async () => {
  gatewayMock.mockRejectedValue(new Error('permission denied'))
  const run = vi.fn()
  expect(await listStoredProfiles('main', { configPath: 'fixture', run })).toMatchObject({ status: 'unknown' })
  expect(run).not.toHaveBeenCalled()
  expect(processMocks.spawn).not.toHaveBeenCalled()
})

it.each(['permission denied', 'invalid params', 'profile unavailable', 'Gateway permission denied'])('does not classify %s as an unavailable RPC', (message) => {
  expect(isGatewayRpcUnavailable(new Error(message))).toBe(false)
})
