import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `/api/upgrade/check` and `/api/upgrade/openclaw-check` should report
 * whether the release/backend combination they point at was E2E-validated
 * (Task 5 of the P1 version-scheme plan). vi.mock factories are hoisted
 * above top-level declarations, so `manifest` and the `installed` spy are
 * declared via `vi.hoisted` rather than as plain top-level consts.
 */

const { manifest } = vi.hoisted(() => ({
  manifest: {
    latest: { version: '0.3.93', mccVersion: '0.3.93', validated: { openclaw: ['2026.9.3'] }, artifacts: [] },
    history: [{ version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', openclawVersion: '2026.9.3' }],
  },
}))

vi.mock('@/lib/upgrade/manager', () => ({
  fetchManifest: vi.fn(async () => manifest),
  getConfiguredManifestUrl: () => 'https://m/manifest.json',
  pickArtifact: () => null,
}))
vi.mock('@/lib/version', async (orig) => ({
  ...(await orig<typeof import('@/lib/version')>()),
  getVersionInfo: () => ({ version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', commit: null, buildTime: 't' }),
}))

const { installed } = vi.hoisted(() => ({
  installed: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('@/lib/openclaw/installed-version', () => ({ readInstalledOpenclawVersion: () => installed() }))

beforeEach(() => {
  installed.mockReset()
  delete process.env.MCC_AGENT_RUNTIME
})

describe('/api/upgrade/check validation', () => {
  it('validated when the local OpenClaw is on the new release list', async () => {
    installed.mockResolvedValue('2026.9.3')
    const { GET } = await import('@/app/api/upgrade/check/route')
    const body = await (await GET(new Request('http://x/api/upgrade/check'))).json()
    expect(body.validation).toEqual({ backend: 'openclaw', localVersion: '2026.9.3', validated: ['2026.9.3'], status: 'validated' })
  })

  it('unvalidated — still reports hasUpdate so the button stays', async () => {
    installed.mockResolvedValue('2026.9.4')
    const { GET } = await import('@/app/api/upgrade/check/route')
    const body = await (await GET(new Request('http://x/api/upgrade/check'))).json()
    expect(body.validation.status).toBe('unvalidated')
    expect(body.hasUpdate).toBe(true)
  })

  it('hermes backend: no local version reader yet → unknown, not a warning', async () => {
    process.env.MCC_AGENT_RUNTIME = 'hermes'
    const { GET } = await import('@/app/api/upgrade/check/route')
    const body = await (await GET(new Request('http://x/api/upgrade/check'))).json()
    expect(body.validation).toMatchObject({ backend: 'hermes', status: 'unknown' })
    expect(installed).not.toHaveBeenCalled()
  })
})

describe('/api/upgrade/openclaw-check validation', () => {
  it('warns when npm latest is not validated for the running MCC', async () => {
    installed.mockResolvedValue('2026.9.3')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '2026.9.4', time: null }))))
    const { GET } = await import('@/app/api/upgrade/openclaw-check/route')
    const body = await (await GET()).json()
    expect(body.hasUpdate).toBe(true)
    expect(body.validation).toEqual({ mccVersion: '0.3.92', validated: ['2026.9.3'], status: 'unvalidated' })
    vi.unstubAllGlobals()
  })
})
