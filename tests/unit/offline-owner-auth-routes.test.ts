import { gatewayMock } from './helpers/offline-owner-mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as profiles from '@/lib/openclaw/auth-profiles'
import { GET } from '@/app/api/openclaw/auth/agents/route'
import { POST } from '@/app/api/openclaw/auth/remove/route'
import { guardAgentsDuring } from '@/lib/openclaw/config-guard'

vi.mock('@/lib/openclaw/config-guard', () => ({
  guardAgentsDuring: vi.fn(async (run: () => Promise<void>) => run()),
  waitForAgentOverride: vi.fn(),
}))

beforeEach(() => {
  gatewayMock.mockImplementation(async () => { throw new Error('Unexpected gateway RPC') })
  vi.spyOn(profiles, 'listAgents').mockResolvedValue([{ id: 'main', profilesPath: '', statePath: '' }])
})
afterEach(() => vi.restoreAllMocks())

describe('auth routes', () => {
  it('returns partial profiles with an explicit unknown store warning', async () => {
    vi.spyOn(profiles, 'readProfiles').mockResolvedValue({ profiles: {
      'kimi:manual': { provider: 'kimi', type: 'api_key' },
    } })
    vi.spyOn(profiles, 'readState').mockResolvedValue({})
    vi.spyOn(profiles, 'listStoredProfiles').mockResolvedValue({ status: 'unknown', error: 'Stored auth profiles could not be read.' })
    const response = await GET()
    expect(response.status).toBe(200)
    expect((await response.json()).agents[0]).toMatchObject({
      id: 'main', storeStatus: 'unknown', storeError: 'Stored auth profiles could not be read.',
      profiles: [{ profileId: 'kimi:manual' }],
    })
  })

  it('responds with a clear 503 ownership error and invalidates the store cache', async () => {
    vi.spyOn(profiles, 'removeProfile').mockRejectedValue(new profiles.OfflineStateOwnershipError('Reconnect MCC to the gateway and retry.'))
    const invalidate = vi.spyOn(profiles, 'invalidateStoredProfiles')
    const response = await POST({ json: async () => ({ agent: 'main', profileId: 'kimi:manual' }) } as any)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'OPENCLAW_OFFLINE_STATE_OWNERSHIP', error: 'Reconnect MCC to the gateway and retry.' })
    expect(invalidate).toHaveBeenCalled()
  })

  it('retains multi-agent targeting and the existing config guard', async () => {
    vi.spyOn(profiles, 'listAgents').mockResolvedValue([
      { id: 'main', profilesPath: '', statePath: '' }, { id: 'sales', profilesPath: '', statePath: '' },
    ])
    const remove = vi.spyOn(profiles, 'removeProfile').mockResolvedValue()
    const response = await POST({ json: async () => ({ agents: ['sales', 'main'], profileId: 'kimi:manual' }) } as any)
    expect(response.status).toBe(200)
    expect(remove.mock.calls).toEqual([['sales', 'kimi:manual'], ['main', 'kimi:manual']])
    expect(guardAgentsDuring).toHaveBeenCalled()
    expect(await response.json()).toEqual({ removed: { profileId: 'kimi:manual', agents: ['sales', 'main'] } })
  })
})
