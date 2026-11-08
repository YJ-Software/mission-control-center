import { gatewayMock, processMocks } from './helpers/offline-owner-mocks'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLogoutArgs, invalidateStoredProfiles, listStoredProfiles, removeProfile,
  OfflineStateOwnershipError, withStoreOnlyProfiles,
} from '@/lib/openclaw/auth-profiles'

let dir: string
let configPath: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'offline-owner-'))
  configPath = join(dir, 'config.json')
  writeFileSync(configPath, JSON.stringify({ auth: { profiles: {
    'kimi:manual': { provider: 'kimi', mode: 'api_key' },
    'alias:manual': { provider: 'actual-provider', mode: 'oauth' },
  } } }))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  invalidateStoredProfiles()
  gatewayMock.mockReset()
  processMocks.spawn.mockClear()
})

describe('online profile removal', () => {
  it('uses the selected agent, provider and single profile through the existing RPC', async () => {
    gatewayMock.mockResolvedValue({ removedProfiles: ['alias:manual'] })
    await removeProfile('sales', 'alias:manual', { configPath })
    expect(gatewayMock).toHaveBeenCalledWith('models.authLogout', {
      provider: 'actual-provider', agentId: 'sales', profileIds: ['alias:manual'],
    })
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each(['Gateway RPC not available', 'Gateway WebSocket not connected', 'unknown method: models.authLogout', 'RPC timeout for models.authLogout'])('falls back to the existing CLI on %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    const run = vi.fn(async () => ({ code: 0, output: '', timedOut: false }))
    await removeProfile('sales', 'kimi:manual', { configPath, run })
    expect(run).toHaveBeenCalledWith(buildLogoutArgs('sales', 'kimi:manual'))
  })

  it('does not retry a rejected mutation through the CLI', async () => {
    gatewayMock.mockRejectedValue(new Error('profileIds contain unavailable auth profiles'))
    const run = vi.fn()
    await expect(removeProfile('main', 'kimi:manual', { configPath, run })).rejects.toThrow('unavailable auth profiles')
    expect(run).not.toHaveBeenCalled()
  })

  it('returns an actionable typed ownership error without the CLI dump or state path', async () => {
    gatewayMock.mockRejectedValue(new Error('Gateway WebSocket not connected'))
    const run = async () => ({ code: 1, timedOut: false, output:
      'Cannot admit models.auth for system/agent credentials in state root /private/state: This operation requires exclusive offline state ownership. No local mutation was attempted.' })
    const error = await removeProfile('main', 'kimi:manual', { configPath, run }).catch((err) => err)
    expect(error).toBeInstanceOf(OfflineStateOwnershipError)
    expect(error.code).toBe('OPENCLAW_OFFLINE_STATE_OWNERSHIP')
    expect(error.message).toContain('Reconnect MCC to the gateway')
    expect(error.message).not.toContain('/private/state')
  })

  it('still uses CLI for a leftover profile after the last config profile is gone', async () => {
    const emptyPath = join(dir, 'empty.json')
    writeFileSync(emptyPath, JSON.stringify({ auth: { profiles: {} } }))
    gatewayMock.mockRejectedValue(new Error('unknown method: models.authLogout'))
    const run = vi.fn(async () => ({ code: 0, output: '', timedOut: false }))
    await removeProfile('main', 'kimi:manual', { configPath: emptyPath, run })
    expect(run).toHaveBeenCalledWith(buildLogoutArgs('main', 'kimi:manual'))
  })
})

describe('online stored profile listing', () => {
  it('flattens provider profiles, preserving store-only credentials without spawning a CLI', async () => {
    gatewayMock.mockResolvedValue({ ts: 1, providers: [
      { provider: 'kimi', profiles: [{ profileId: 'kimi:manual', type: 'api_key', source: 'saved' }] },
      { provider: 'google', profiles: [{ profileId: 'google:work', type: 'oauth' }] },
    ] })
    const stored = await listStoredProfiles('sales', { configPath })
    expect(gatewayMock).toHaveBeenCalledWith('models.authStatus', { agentId: 'sales' })
    expect(stored).toEqual([
      { id: 'kimi:manual', provider: 'kimi', type: 'api_key' },
      { id: 'google:work', provider: 'google', type: 'oauth' },
    ])
    expect(withStoreOnlyProfiles([], stored)).toHaveLength(2)
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('accepts a verified empty RPC list', async () => {
    gatewayMock.mockResolvedValue({ providers: [] })
    expect(await listStoredProfiles('main', { configPath })).toEqual([])
  })

  it.each(['Gateway WebSocket not connected', 'unknown method: models.authStatus'])('uses CLI list when %s', async (message) => {
    gatewayMock.mockRejectedValue(new Error(message))
    const run = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ profiles: [{ id: 'kimi:leftover', type: 'api_key' }] }) }))
    expect(await listStoredProfiles('main', { configPath, run })).toEqual([{ id: 'kimi:leftover', type: 'api_key' }])
    expect(run).toHaveBeenCalledWith(['models', 'auth', 'list', '--agent', 'main', '--json'])
  })

  it.each([
    { providers: [], unavailable: { code: 'PREPARED_MODEL_AUTH_UNAVAILABLE' } },
    { unexpected: [] },
    { providers: [{ provider: 'kimi', profiles: null }] },
  ])('does not treat an unavailable/malformed response as an empty store: %j', async (raw) => {
    gatewayMock.mockResolvedValue(raw)
    const result = await listStoredProfiles('main', { configPath, run: async () => ({ code: 1, stdout: '' }) })
    expect(result).toMatchObject({ status: 'unknown', error: expect.stringContaining('could not be read') })
  })

  it('reports unknown even if config has lost all auth metadata and CLI throws', async () => {
    const emptyPath = join(dir, 'no-auth.json')
    writeFileSync(emptyPath, '{}')
    gatewayMock.mockRejectedValue(new Error('Gateway RPC not available'))
    expect(await listStoredProfiles('main', { configPath: emptyPath, run: async () => { throw new Error('spawn failed') } })).toMatchObject({ status: 'unknown' })
  })

  it('coalesces concurrent RPC reads and invalidates after a mutation', async () => {
    gatewayMock.mockResolvedValue({ providers: [] })
    await Promise.all(Array.from({ length: 4 }, () => listStoredProfiles('main', { configPath })))
    expect(gatewayMock).toHaveBeenCalledTimes(1)
    invalidateStoredProfiles()
    await listStoredProfiles('main', { configPath })
    expect(gatewayMock).toHaveBeenCalledTimes(2)
  })
})
