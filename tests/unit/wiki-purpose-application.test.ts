import { gatewayMock } from './helpers/offline-owner-mocks'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { restartOpenclawGateway } from '@/lib/openclaw/restart-gateway'

const mocks = vi.hoisted(() => ({
  home: '',
  saveSetting: vi.fn(),
}))

vi.mock('os', async importOriginal => ({
  ...await importOriginal<typeof import('os')>(),
  homedir: () => mocks.home,
}))
vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({
      values: (value: unknown) => ({
        onConflictDoUpdate: () => ({ run: () => mocks.saveSetting(value) }),
      }),
    }),
  },
}))
vi.mock('@/lib/openclaw/restart-gateway', () => ({
  restartOpenclawGateway: vi.fn(),
}))

let configPath: string
let setPurpose: typeof import('@/lib/wiki/purpose').setPurpose

beforeAll(async () => {
  mocks.home = mkdtempSync(path.join(tmpdir(), 'mcc-wiki-purpose-'))
  configPath = path.join(mocks.home, '.openclaw', 'openclaw.json')
  mkdirSync(path.dirname(configPath))
  ;({ setPurpose } = await import('@/lib/wiki/purpose'))
})

beforeEach(() => {
  writeFileSync(configPath, JSON.stringify({ plugins: { slots: { memory: 'memory-lancedb' } } }))
  gatewayMock.mockReset()
  mocks.saveSetting.mockClear()
  vi.mocked(restartOpenclawGateway).mockReset()
  vi.mocked(restartOpenclawGateway).mockResolvedValue({ stdout: 'restarted\n', stderr: '' })
})

afterEach(() => vi.useRealTimers())
afterAll(() => rmSync(mocks.home, { recursive: true, force: true }))

function snapshot(appliedConfigHash = 'new', memorySlot = 'memory-wiki') {
  const sourceConfig = JSON.parse(readFileSync(configPath, 'utf8'))
  sourceConfig.plugins.slots.memory = memorySlot
  sourceConfig.plugins.entries['memory-lancedb'].config.embedding.apiKey = '__OPENCLAW_REDACTED__'
  return { valid: true, configRevisionHash: 'new', appliedConfigHash, sourceConfig }
}

describe('setPurpose', () => {
  it('waits for the desired plugin block and its applied revision before returning without a restart', async () => {
    vi.useFakeTimers()
    gatewayMock
      .mockImplementationOnce(async () => snapshot('new', 'memory-lancedb'))
      .mockImplementationOnce(async () => snapshot('old'))
      .mockImplementationOnce(async () => snapshot())

    const apply = setPurpose('customer-service')
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(apply).resolves.toMatchObject({ application: 'hot-applied' })
    expect(gatewayMock).toHaveBeenCalledTimes(3)
    expect(gatewayMock).toHaveBeenCalledWith('config.get', {})
    expect(mocks.saveSetting).toHaveBeenCalledWith({ key: 'wiki.purpose', value: 'customer-service' })
    expect(restartOpenclawGateway).not.toHaveBeenCalled()
  })

  it('restarts through the barrier on a legacy snapshot without revision fields', async () => {
    vi.useFakeTimers()
    gatewayMock.mockResolvedValue({ valid: true, config: {} })
    await expect(setPurpose('customer-service')).resolves.toMatchObject({ application: 'restarted' })
    expect(gatewayMock).toHaveBeenCalledOnce()
    expect(restartOpenclawGateway).toHaveBeenCalledWith(expect.objectContaining({
      configWrittenAt: Date.now(),
    }))
  })

  it('falls back when reload is off', async () => {
    writeFileSync(configPath, JSON.stringify({ gateway: { reload: { mode: 'off' } } }))
    await expect(setPurpose('customer-service')).resolves.toMatchObject({ application: 'restarted' })
    expect(gatewayMock).not.toHaveBeenCalled()
    expect(restartOpenclawGateway).toHaveBeenCalledOnce()
  })

  it('falls back at the deadline even when the last RPC never resolves', async () => {
    vi.useFakeTimers()
    gatewayMock.mockImplementationOnce(async () => snapshot('old'))
    gatewayMock.mockImplementationOnce(() => new Promise(() => {}))
    const apply = setPurpose('customer-service')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(restartOpenclawGateway).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(apply).resolves.toMatchObject({ application: 'restarted' })
  })
})
