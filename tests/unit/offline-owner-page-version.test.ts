import { gatewayMock, processMocks } from './helpers/offline-owner-mocks'
import { expect, it, vi } from 'vitest'
import { readInstalledOpenclawVersion } from '@/lib/openclaw/installed-version'
import { getOpenClawVersionInfo, getServicesStatus } from '@/lib/services-status'
import { withOpenclawCli } from '@/lib/openclaw/cli-limiter'

vi.mock('@/lib/morning-report/openclaw', () => ({ findOpenclawBin: () => 'openclaw' }))

it('queues header/sidebar/upgrade version probes behind auth CLI work, with at most two processes', async () => {
  gatewayMock.mockImplementation(async () => { throw new Error('Unexpected gateway RPC') })
  const exits: (() => void)[] = []
  let active = 0
  let peak = 0
  processMocks.execFileSync.mockImplementation((bin) => {
    if (!['systemctl', 'pgrep', 'which', 'tailscale', 'opencli'].includes(bin)) throw new Error(`Unexpected synchronous CLI: ${bin}`)
    return ''
  })
  processMocks.execFile.mockImplementation((bin, args, _opts, callback) => {
    expect(bin).toBe('openclaw')
    expect(args).toEqual(['--version'])
    active++
    peak = Math.max(peak, active)
    exits.push(() => { active--; callback(null, 'OpenClaw 2026.11.1 (test)', '') })
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '2026.11.1' }) })))
  let releaseAuth!: () => void
  // 保留一個登入 CLI 額度，模擬認證頁同時進行中的登入。
  const auth = withOpenclawCli(() => new Promise<void>((resolve) => { releaseAuth = resolve }))
  try {
    const probes = [getServicesStatus(), getOpenClawVersionInfo(), readInstalledOpenclawVersion()]
    expect(processMocks.execFile).toHaveBeenCalledTimes(1)
    expect(active).toBe(1)
    releaseAuth()
    await auth
    await vi.waitFor(() => expect(active).toBe(2))
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0))
      exits.shift()!()
    }
    const [services, info, version] = await Promise.all(probes)
    expect(services).toContainEqual({ name: 'openclaw', active: true, version: '2026.11.1' })
    expect(info).toMatchObject({ installed: '2026.11.1', latest: '2026.11.1', updateAvailable: false })
    expect(version).toBe('2026.11.1')
    expect(peak).toBe(2)
    expect(active).toBe(0)
    expect(gatewayMock).not.toHaveBeenCalled()
  } finally {
    releaseAuth()
    while (exits.length) exits.shift()!()
    vi.unstubAllGlobals()
  }
})
