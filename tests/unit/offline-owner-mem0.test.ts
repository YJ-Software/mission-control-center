import { gatewayMock, processMocks } from './helpers/offline-owner-mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerEnv } from '@/lib/server-env'
import { OPENCLAW_WRITE_TIMEOUT_MS } from '@/lib/openclaw/models-config'
import { writeMem0McpConfig } from '@/lib/customer-service/mem0-config'
import { setProvider } from '@/lib/customer-service/mem0-provider'
import { bindToMcp, unbindFromMcp } from '@/lib/customer-service/mem0-neo4j'
import { runInstall } from '@/lib/customer-service/mem0-setup'

const fixture = vi.hoisted(() => ({ config: {} as any }))
vi.mock('fs', async (orig) => ({
  ...await orig<typeof import('fs')>(),
  existsSync: () => true,
  readFileSync: (path: string) => {
    if (!path.endsWith('openclaw.json')) throw new Error('Unexpected file read')
    return JSON.stringify(fixture.config)
  },
}))

const server = { command: 'uv', args: ['run', 'server.py'], env: {
  PRESERVE: 'yes', MEM0_NEO4J_URL: 'bolt://test', MEM0_NEO4J_USER: 'neo4j', MEM0_NEO4J_PASSWORD: 'test-only',
}, enabled: true, toolFilter: { include: ['memory_*'] } }

beforeEach(() => {
  fixture.config = { mcp: { servers: { 'openclaw-mem0': structuredClone(server) } } }
  gatewayMock.mockImplementation(async () => { throw new Error('Unexpected gateway RPC') })
  processMocks.execFile.mockReset().mockImplementation((bin, args, opts, callback) => {
    if (bin !== 'openclaw' || args[0] !== 'config' || args[1] !== 'set') throw new Error('Unexpected process')
    callback(null, 'updated', 'warning')
  })
})

function writtenValue() {
  const [bin, args, opts] = processMocks.execFile.mock.calls[0]
  expect(bin).toBe('openclaw')
  expect(args.slice(0, 3)).toEqual(['config', 'set', 'mcp.servers.openclaw-mem0'])
  expect(args[4]).toBe('--strict-json')
  expect(args).toHaveLength(5)
  expect(opts).toEqual({ timeout: OPENCLAW_WRITE_TIMEOUT_MS, env: getServerEnv() })
  expect(gatewayMock).not.toHaveBeenCalled()
  return JSON.parse(args[3])
}

describe('mem0 online config writes', () => {
  it('passes the complete server JSON as one argv value with strict parsing', async () => {
    expect(await writeMem0McpConfig(server)).toBe('updatedwarning')
    expect(writtenValue()).toEqual(server)
  })

  it('preserves server options and unrelated env on provider changes', async () => {
    await setProvider({ mode: 'gemini', model: 'test-model', apiKey: 'test-only', baseUrl: '', temperature: 0.2, maxTokens: 800 })
    expect(writtenValue()).toEqual({ ...server, env: { ...server.env,
      MEM0_LLM_MODE: 'gemini', MEM0_LLM_MODEL: 'test-model', GOOGLE_API_KEY: 'test-only',
      MEM0_LLM_TEMPERATURE: '0.2', MEM0_LLM_MAX_TOKENS: '800',
    } })
  })

  it('uses the same config writer for Neo4j binding', async () => {
    await bindToMcp('test-new-password')
    expect(writtenValue()).toEqual({ ...server, env: { ...server.env,
      MEM0_NEO4J_URL: 'bolt://127.0.0.1:7687', MEM0_NEO4J_PASSWORD: 'test-new-password',
    } })
  })

  it('uses the same writer for Neo4j unbinding, retaining other env/options', async () => {
    await unbindFromMcp()
    expect(writtenValue()).toEqual({ ...server, env: { PRESERVE: 'yes' } })
  })

  it('propagates write failures', async () => {
    processMocks.execFile.mockImplementation((_bin, _args, _opts, callback) => callback(new Error('config write failed')))
    await expect(writeMem0McpConfig(server)).rejects.toThrow('config write failed')
  })

  it('registers the MCP server via config set in the install wizard', async () => {
    fixture.config = {}
    // All installed services are simulated; neither localhost nor systemctl is contacted.
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'bge-m3' }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    processMocks.execFile.mockImplementation((bin, args, _opts, callback) => {
      if (bin === 'which') return callback(null, `${args[0]}\n`, '')
      if (bin === 'docker' && args[0] === 'ps') return callback(null, '', '')
      if (bin === 'uv' && args[0] === '--version') return callback(null, 'uv test', '')
      if (bin === 'openclaw' && (args[0] === 'config' || args[0] === 'gateway')) return callback(null, '', '')
      throw new Error(`Unexpected process: ${bin} ${args.join(' ')}`)
    })
    try {
      const progress = vi.fn()
      await runInstall(progress)
      const configCall = processMocks.execFile.mock.calls.find(([, args]) => args[0] === 'config')
      expect(configCall?.[1].slice(0, 3)).toEqual(['config', 'set', 'mcp.servers.openclaw-mem0'])
      expect(configCall?.[1][4]).toBe('--strict-json')
      expect(JSON.parse(configCall?.[1][3])).toMatchObject({ command: 'uv', env: { MEM0_LLM_MODE: 'openai' } })
      expect(progress.mock.calls.some(([event]) => event.stage === 'error')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
