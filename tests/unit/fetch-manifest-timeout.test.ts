import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchManifest } from '@/lib/upgrade/manager'

/**
 * A manifest host that hangs (rather than refuses) must not hang every
 * caller of fetchManifest (check, action, openclaw-check). Asserts the
 * real fetchManifest bounds its request with an AbortSignal — without
 * actually waiting out a timeout.
 */
describe('fetchManifest timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes an AbortSignal and cache: no-store to fetch', async () => {
    const manifest = { latest: { version: '1.0.0', artifacts: [] } }
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(manifest)))
    vi.stubGlobal('fetch', fetchMock)

    await fetchManifest('https://m/manifest.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    expect(init?.cache).toBe('no-store')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
