import { describe, expect, it, vi } from 'vitest'
import { ensureProviderPlugin, type PluginProbe } from '@/lib/openclaw/auth-jobs'
import { findProvider } from '@/lib/openclaw/auth-providers'

// OpenClaw 2026.8.1 turned Kimi into a first-class ClawHub plugin
// (@openclaw/kimi-provider, manifest id "kimi"). Creating an auth profile for a
// plugin-backed provider WITHOUT installing + consenting to the plugin makes the
// gateway refuse to start:
//
//   Plugin "kimi" requires capability consent.
//   OpenClaw plugin verification failed; refusing to report the gateway ready.
//
// systemd then restart-loops until it hits the rate limit and the gateway stays
// down for good. Worse, the plugin never lands in `plugins list`, so the CLI's
// own advice (`openclaw plugins enable kimi --accept-capabilities`) answers
// "Plugin not found: kimi" — there is no recovery path short of hand-editing
// openclaw.json. Verified on a throwaway VPS 2026-08-31: paste-api-key alone
// kills the gateway; removing auth.profiles["kimi:*"] brings it back in 10s;
// installing the plugin with --accept-capabilities first keeps it healthy.
//
// These tests pin the guard that has to run BEFORE paste-api-key.

function probe(over: Partial<PluginProbe> = {}): PluginProbe {
  return {
    listed: vi.fn(async () => false),
    available: vi.fn(async () => false),
    install: vi.fn(async () => 0),
    ...over,
  }
}

const logs = () => vi.fn()

describe('ensureProviderPlugin', () => {
  it('is a no-op for providers that are not plugin-backed', async () => {
    const p = probe()
    const code = await ensureProviderPlugin(findProvider('deepseek'), p, logs())
    expect(code).toBe(0)
    expect(p.install).not.toHaveBeenCalled()
    expect(p.listed).not.toHaveBeenCalled()
  })

  it('skips installing when the plugin is already registered', async () => {
    const p = probe({ listed: vi.fn(async () => true) })
    const code = await ensureProviderPlugin(findProvider('kimi'), p, logs())
    expect(code).toBe(0)
    expect(p.install).not.toHaveBeenCalled()
  })

  it('installs with capability consent when the plugin is available but missing', async () => {
    const p = probe({ available: vi.fn(async () => true) })
    const code = await ensureProviderPlugin(findProvider('kimi'), p, logs())
    expect(code).toBe(0)
    expect(p.install).toHaveBeenCalledWith('clawhub:@openclaw/kimi-provider')
  })

  // The regression that matters: if we cannot get the plugin installed on an
  // OpenClaw that knows about it, pasting the key would brick the gateway.
  // Abort the job instead of proceeding.
  it('aborts when the plugin is available but installation fails', async () => {
    const p = probe({
      available: vi.fn(async () => true),
      install: vi.fn(async () => 1),
    })
    const code = await ensureProviderPlugin(findProvider('kimi'), p, logs())
    expect(code).not.toBe(0)
  })

  // Older OpenClaw (≤2026.7.1-2) has no kimi plugin at all; the legacy
  // models.providers template path still works there, so don't block auth.
  it('stays out of the way on OpenClaw versions that have no such plugin', async () => {
    const p = probe({ available: vi.fn(async () => false) })
    const code = await ensureProviderPlugin(findProvider('kimi'), p, logs())
    expect(code).toBe(0)
    expect(p.install).not.toHaveBeenCalled()
  })
})
