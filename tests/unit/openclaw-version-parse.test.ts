import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'child_process'

/**
 * Regression: the header's "OpenClaw <ver> 可更新" badge was stuck on for boxes
 * already running the newest build.
 *
 * `openclaw --version` prints `OpenClaw 2026.7.1-2 (0790d9f) — …`, but the
 * installed version was matched with `/OpenClaw\s+([\d.]+)/`. The `[\d.]`
 * class excludes `-`, so the match stopped at the hyphen and yielded
 * `2026.7.1`. `updateAvailable` compares with `installed !== latest`, and
 * `"2026.7.1" !== "2026.7.1-2"` is always true — so the badge never cleared,
 * and the update button reinstalled the version already present.
 *
 * Build suffixes are normal for openclaw releases (`-2` is the current
 * stable), so this hit every customer on a suffixed build, not just dev.
 */

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

// findOpenclawBin() probes the filesystem for a real binary; the path it
// returns is irrelevant here because execFileSync is stubbed.
vi.mock('@/lib/morning-report/openclaw', () => ({
  findOpenclawBin: () => '/usr/local/bin/openclaw',
}))

import { getOpenClawVersionInfo } from '@/lib/services-status'

const mockExec = vi.mocked(execFileSync)

/** Stub `openclaw --version` output and the npm registry's `latest`. */
function arrange(cliOutput: string, npmLatest: string) {
  mockExec.mockReturnValue(cliOutput as never)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ version: npmLatest }),
  })))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('getOpenClawVersionInfo', () => {
  it('keeps the build suffix so an up-to-date box reports no update', async () => {
    arrange('OpenClaw 2026.7.1-2 (0790d9f) — One CLI to rule them all', '2026.7.1-2')

    const info = await getOpenClawVersionInfo()

    // The regression: this used to be '2026.7.1', which never matched latest.
    expect(info.installed).toBe('2026.7.1-2')
    expect(info.updateAvailable).toBe(false)
  })

  it('still flags a real update across build suffixes', async () => {
    arrange('OpenClaw 2026.7.1-2 (0790d9f) — One CLI to rule them all', '2026.7.1-3')

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('2026.7.1-2')
    expect(info.updateAvailable).toBe(true)
  })

  it('handles a plain version with no suffix', async () => {
    arrange('OpenClaw 2026.5.5 (b1abf9d) — One CLI to rule them all', '2026.5.5')

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('2026.5.5')
    expect(info.updateAvailable).toBe(false)
  })

  it('handles a prerelease suffix', async () => {
    arrange('OpenClaw 2026.8.1-beta.3 (deadbee)', '2026.8.1-beta.3')

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('2026.8.1-beta.3')
    expect(info.updateAvailable).toBe(false)
  })

  it('falls back to a bare version line when the product name is absent', async () => {
    arrange('2026.7.1-2', '2026.7.1-2')

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('2026.7.1-2')
    expect(info.updateAvailable).toBe(false)
  })

  it('reports no update when openclaw is missing rather than guessing', async () => {
    arrange('', '2026.7.1-2')

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('')
    expect(info.updateAvailable).toBe(false)
  })

  it('does not claim an update when the registry is unreachable', async () => {
    mockExec.mockReturnValue('OpenClaw 2026.7.1-2 (0790d9f)' as never)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const info = await getOpenClawVersionInfo()

    expect(info.installed).toBe('2026.7.1-2')
    expect(info.latest).toBe('')
    expect(info.updateAvailable).toBe(false)
  })
})
