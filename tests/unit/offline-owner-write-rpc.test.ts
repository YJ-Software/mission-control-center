import { gatewayMock, processMocks } from './helpers/offline-owner-mocks'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gatewayConfigPatchWithFallback } from '@/lib/openclaw/rpc-fallback'
import { clearAgentModelOverride, setAgentModelOverride, writeAgentsConfigPath } from '@/lib/openclaw/models-config'
import { buildPasteApiKeyJob } from '@/lib/openclaw/auth-jobs'
import { findProvider } from '@/lib/openclaw/auth-providers'
import { writeMem0McpConfig } from '@/lib/customer-service/mem0-config'
import { setProvider } from '@/lib/customer-service/mem0-provider'
import { unbindFromMcp } from '@/lib/customer-service/mem0-neo4j'
import { withOpenclawCli } from '@/lib/openclaw/cli-limiter'

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
const model = { primary: 'kimi/kimi-for-coding' }
const template = findProvider('kimi')!.providerConfig!
const server = { command: 'uv', args: ['run', 'server.py'], env: { PRESERVE: 'yes' } }
let hash: string
let patchError: string | undefined
let failOnce: boolean
let afterWrite: () => void

beforeEach(() => {
  vi.stubGlobal('__gatewayVersion', '2026.11.2')
  fixture.config = {
    agents: { entries: { main: { model: { primary: 'old/model' }, tools: { token: '__OPENCLAW_REDACTED__' } }, other: {} } },
    unrelated: { apiKey: '__OPENCLAW_REDACTED__' },
  }
  hash = 'hash-before'
  patchError = undefined
  failOnce = false
  afterWrite = () => {}
  processMocks.spawn.mockReset().mockImplementation(refuseSpawn)
  processMocks.execFile.mockReset().mockImplementation(refuseExec)
  gatewayMock.mockReset().mockImplementation(async (method) => {
    if (method === 'config.get') return { valid: true, hash, config: structuredClone(fixture.config), raw: 'NEVER USE RAW' }
    expect(method).toBe('config.patch')
    if (patchError) {
      const message = patchError
      if (failOnce) { patchError = undefined; hash = 'hash-after' }
      throw new Error(message)
    }
    afterWrite()
    return { ok: true }
  })
})
afterEach(() => vi.unstubAllGlobals())

const cases = [
  {
    name: 'agent override', call: () => setAgentModelOverride('main', model),
    patch: { agents: { entries: { main: { model } } } }, arrays: [] as string[],
    args: () => ['config', 'set', 'agents.entries', JSON.stringify({ ...fixture.config.agents.entries, main: { ...fixture.config.agents.entries.main, model } }), '--strict-json'],
    applied: () => { fixture.config.agents.entries.main.model = model },
    failure: 'config set agents.entries failed (1): invalid config: test validation',
  },
  {
    name: 'clear agent override', call: () => clearAgentModelOverride('main'),
    patch: { agents: { entries: { main: { model: null } } } }, arrays: [] as string[],
    args: () => {
      const entries = structuredClone(fixture.config.agents.entries)
      delete entries.main.model
      return ['config', 'set', 'agents.entries', JSON.stringify(entries), '--strict-json']
    },
    applied: () => { delete fixture.config.agents.entries.main.model },
    failure: 'config set agents.entries failed (1): invalid config: test validation',
  },
  {
    name: 'provider template',
    call: () => buildPasteApiKeyJob({ provider: 'kimi', agent: 'main', apiKey: 'test-only', triggeredBy: 'api' }).phases[3].inline!(vi.fn(), {} as any),
    patch: { models: { providers: { kimi: template } } }, arrays: ['models.providers.kimi.models'],
    args: () => ['config', 'set', 'models.providers.kimi', JSON.stringify(template), '--strict-json'],
    applied: () => {}, failure: 1,
  },
  {
    name: 'mem0 server', call: () => writeMem0McpConfig(server),
    patch: { mcp: { servers: { 'openclaw-mem0': server } } }, arrays: ['mcp.servers.openclaw-mem0.args'],
    args: () => ['config', 'set', 'mcp.servers.openclaw-mem0', JSON.stringify(server), '--strict-json'],
    applied: () => {}, failure: 'config set mcp.servers.openclaw-mem0 failed: invalid config: test validation',
  },
]

function patches() { return gatewayMock.mock.calls.filter(([method]) => method === 'config.patch').map(([, params]) => params) }
function expectedPatch(c: typeof cases[number], baseHash = 'hash-before') {
  return { raw: JSON.stringify(c.patch), baseHash, ...(c.arrays.length ? { replacePaths: c.arrays } : {}) }
}
function cliOutput(args: string[], done: () => void, code = 0, stderr = '') {
  processMocks.spawn.mockImplementation((bin, actualArgs) => {
    expect(bin).toBe('openclaw')
    expect(actualArgs).toEqual(['--log-level', 'silent', '--no-color', ...args])
    const child = new EventEmitter() as any
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.kill = vi.fn()
    queueMicrotask(() => { done(); child.stderr.emit('data', stderr); child.emit('close', code) })
    return child
  })
  processMocks.execFile.mockImplementation((bin, actualArgs, options, callback) => {
    expect(bin).toBe('openclaw')
    expect(actualArgs).toEqual(args)
    expect(options.timeout).toBe(90_000)
    done()
    callback(code ? Object.assign(new Error(stderr), { code, stderr }) : null, 'updated', '')
  })
}

for (const c of cases) describe(c.name, () => {
  beforeEach(() => { afterWrite = c.applied })
  it('sends only the target with the config.get hash and retains post-write polling', async () => {
    await c.call()
    expect(patches()).toEqual([expectedPatch(c)])
    expect(JSON.stringify(patches())).not.toContain('__OPENCLAW_REDACTED__')
    expect(processMocks.spawn).not.toHaveBeenCalled()
    expect(processMocks.execFile).not.toHaveBeenCalled()
    if (c.name.includes('agent')) expect(gatewayMock.mock.calls.filter(([method]) => method === 'config.get')).toHaveLength(3)
  })
  it('re-reads and retries a hash conflict exactly once', async () => {
    patchError = 'config changed since last load; re-run config.get and retry'
    failOnce = true
    await c.call()
    expect(patches()).toEqual([expectedPatch(c), expectedPatch(c, 'hash-after')])
    expect(processMocks.spawn).not.toHaveBeenCalled()
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
  it.each(['unknown method: config.patch', 'Gateway disconnected', 'RPC timeout for config.patch', 'rate limit exceeded for config.patch; retry after 59s'])(
    'keeps exact CLI args on %s', async (message) => {
      patchError = message
      cliOutput(c.args(), c.applied)
      await c.call()
      expect(processMocks.spawn.mock.calls.length + processMocks.execFile.mock.calls.length).toBe(1)
    })
  it('keeps validation failure semantics without retrying CLI', async () => {
    patchError = 'invalid config: test validation'
    if (typeof c.failure === 'number') expect(await c.call()).toBe(c.failure)
    else {
      await expect(c.call()).rejects.toThrow(c.failure)
      if (c.name === 'mem0 server') await expect(c.call()).rejects.toMatchObject({ code: 1, stderr: patchError })
    }
    expect(processMocks.spawn).not.toHaveBeenCalled()
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
  it('retains the original nonzero CLI outcome', async () => {
    patchError = 'unknown method'
    cliOutput(c.args(), () => {}, 124, 'timed out')
    if (typeof c.failure === 'number') expect(await c.call()).toBe(124)
    else await expect(c.call()).rejects.toThrow(c.name === 'mem0 server' ? 'timed out' : 'failed (124): timed out')
  })
})

describe('shared config writer safeguards', () => {
  const run = (value: unknown = model, cli = vi.fn(async () => 'cli')) =>
    gatewayConfigPatchWithFallback('agents.entries.main.model', value, cli, 'rpc')

  it.each(['2026.10.8', '2026.10.9', '2026.10.10', '2026.11.1', '2026.11.2', '2026.11.2-1', '2026.11.3', '2026.12.1', '2027.1.1'])(
    'allows version %s (10.8+, CLI itself forwards to config.patch since 10.10)', async (version) => {
      vi.stubGlobal('__gatewayVersion', version)
      expect(await run()).toBe('rpc')
      expect(patches()).toEqual([{ raw: JSON.stringify({ agents: { entries: { main: { model } } } }), baseHash: hash }])
    })
  it.each([undefined, '', 'dev', '2026.9.9', '2026.9.36', '2026.10.7', '2026.11.5-beta.1'])(
    'keeps unknown/unverified version %s on CLI without probing', async (version) => {
      vi.stubGlobal('__gatewayVersion', version)
      expect(await run()).toBe('cli')
      expect(gatewayMock).not.toHaveBeenCalled()
    })
  it('does not use RPC when reload is off', async () => {
    fixture.config.gateway = { reload: { mode: 'off' } }
    expect(await run()).toBe('cli')
    expect(patches()).toEqual([])
  })
  it.each(['plugins.entries.test.config.token', 'hooks.token', 'gateway.port', 'agents.list', 'agents', 'models.providers.constructor'])(
    'keeps unsupported path %s on CLI', async (path) => {
      expect(await gatewayConfigPatchWithFallback(path, {}, async () => 'cli', 'rpc')).toBe('cli')
      expect(gatewayMock).not.toHaveBeenCalled()
    })
  it.each(['Gateway WebSocket not connected', 'unknown method: config.get'])(
    'uses CLI if reading the hash fails with %s', async (message) => {
      gatewayMock.mockRejectedValue(new Error(message))
      expect(await run()).toBe('cli')
    })
  it('expresses unset as null, including explicit array-removal intent', async () => {
    fixture.config.agents.entries.main.model.fallbacks = ['old/backup']
    await run(null)
    expect(patches()).toEqual([{ raw: '{"agents":{"entries":{"main":{"model":null}}}}', baseHash: hash,
      replacePaths: ['agents.entries.main.model.fallbacks'] }])
  })
  it('treats undefined object members as omitted, matching the strict JSON CLI argv', async () => {
    fixture.config.agents.entries.main.model.fallbacks = ['old/backup']
    await run({ ...model, fallbacks: undefined })
    expect(patches()).toEqual([{ raw: JSON.stringify({ agents: { entries: { main: { model: { ...model, fallbacks: null } } } } }),
      baseHash: hash, replacePaths: ['agents.entries.main.model.fallbacks'] }])
  })
  it('deletes omitted object fields and replaces arrays instead of merging ID keyed entries', async () => {
    fixture.config.models = { providers: { test: { apiKey: '__OPENCLAW_REDACTED__', models: [{ id: 'old' }] } } }
    await gatewayConfigPatchWithFallback('models.providers.test', { models: [{ id: 'new' }] }, async () => {}, undefined)
    expect(patches()).toEqual([{ raw: '{"models":{"providers":{"test":{"apiKey":null,"models":[{"id":"new"}]}}}}',
      baseHash: hash, replacePaths: ['models.providers.test.models'] }])
  })
  it.each([{ primary: null }, { primary: '__OPENCLAW_REDACTED__' }, { primary: '${TEST_MODEL}' }])('keeps nonrepresentable replacement %j on CLI', async (value) => {
    expect(await run(value)).toBe('cli')
    expect(gatewayMock).not.toHaveBeenCalled()
  })
  it('keeps dotted agent IDs literal in the patch', async () => {
    await gatewayConfigPatchWithFallback(['agents', 'entries', 'sales.eu', 'model'], model, async () => {}, undefined)
    expect(patches()).toEqual([{ raw: '{"agents":{"entries":{"sales.eu":{"model":{"primary":"kimi/kimi-for-coding"}}}}}', baseHash: hash }])
  })
  it.each(['permission denied', 'invalid params', 'config.patch persisted but was not applied to the active Gateway (unavailable)',
    'config changed since last load; re-run config.get and retry'])(
    'surfaces %s without CLI and bounds conflict retries', async (message) => {
      patchError = message
      const cli = vi.fn(async () => 'cli')
      await expect(run(model, cli)).rejects.toThrow(message)
      expect(cli).not.toHaveBeenCalled()
      expect(patches()).toHaveLength(message.startsWith('config changed') ? 2 : 1)
    })
  it.each([null, {}, { valid: false, config: {} }, { valid: true, config: {} }])('refuses malformed snapshot %j', async (snapshot) => {
    gatewayMock.mockResolvedValue(snapshot)
    await expect(run()).rejects.toThrow('config get failed')
    expect(patches()).toEqual([])
  })
  it('refuses a malformed patch acknowledgment without CLI', async () => {
    gatewayMock.mockImplementation(async (method) => method === 'config.get' ? { hash, config: {} } : {})
    await expect(run()).rejects.toThrow('config patch failed: invalid gateway response')
  })
  it('leaves whole agents snapshot restoration on its original CLI', async () => {
    const value = { entries: { main: {} } }
    cliOutput(['config', 'set', 'agents', JSON.stringify(value), '--strict-json'], () => {})
    await writeAgentsConfigPath('agents', value)
    expect(gatewayMock).not.toHaveBeenCalled()
  })
  it('limits mem0 fallback spawns with the shared CLI queue', async () => {
    vi.stubGlobal('__gatewayVersion', undefined)
    const releases: (() => void)[] = []
    const holders = [0, 1].map(() => withOpenclawCli(() => new Promise<void>((resolve) => releases.push(resolve))))
    cliOutput(cases[3].args(), () => {})
    try {
      const pending = writeMem0McpConfig(server)
      await Promise.resolve()
      expect(processMocks.execFile).not.toHaveBeenCalled()
      releases[0]()
      await pending
      expect(processMocks.execFile).toHaveBeenCalledTimes(1)
    } finally { releases.forEach((release) => release()); await Promise.all(holders) }
  })
})

describe('mem0 multi-field dashboard flows', () => {
  beforeEach(() => {
    fixture.config.mcp = { servers: { 'openclaw-mem0': { ...server, env: { ...server.env,
      OPENAI_API_KEY: 'test-only', OPENAI_BASE_URL: 'https://example.test',
      MEM0_NEO4J_URL: 'bolt://test', MEM0_NEO4J_USER: 'neo4j', MEM0_NEO4J_PASSWORD: 'test-only',
    } } } }
  })
  it('removes old provider keys in one patch while preserving Neo4j/options', async () => {
    await setProvider({ mode: 'gemini', model: 'test-model', apiKey: 'test-new', baseUrl: '', temperature: 0.2, maxTokens: 800 })
    expect(patches()).toHaveLength(1)
    expect(JSON.parse((patches()[0] as any).raw).mcp.servers['openclaw-mem0']).toEqual({ ...server, env: {
      ...fixture.config.mcp.servers['openclaw-mem0'].env,
      OPENAI_API_KEY: null, OPENAI_BASE_URL: null, GOOGLE_API_KEY: 'test-new',
      MEM0_LLM_MODE: 'gemini', MEM0_LLM_MODEL: 'test-model', MEM0_LLM_TEMPERATURE: '0.2', MEM0_LLM_MAX_TOKENS: '800',
    } })
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
  it('unbinding Neo4j deletes only its three env keys', async () => {
    await unbindFromMcp()
    expect(JSON.parse((patches()[0] as any).raw).mcp.servers['openclaw-mem0'].env).toEqual({
      ...fixture.config.mcp.servers['openclaw-mem0'].env,
      MEM0_NEO4J_URL: null, MEM0_NEO4J_USER: null, MEM0_NEO4J_PASSWORD: null,
    })
    expect(processMocks.execFile).not.toHaveBeenCalled()
  })
})
