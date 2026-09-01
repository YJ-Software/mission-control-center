import { describe, expect, it, vi } from 'vitest'
import type { PluginProbe } from '@/lib/openclaw/plugin-consent'

// The wiki purpose switch writes plugins.entries["memory-lancedb"].enabled and
// points plugins.slots.memory at it, then restarts the gateway. memory-lancedb
// is an EXTERNAL plugin, and on OpenClaw 2026.8.1 enabling a plugin that has no
// capability consent makes the gateway refuse to start:
//
//   Plugin "memory-lancedb" requires capability consent.
//   OpenClaw plugin verification failed; refusing to report the gateway ready.
//
// Observed on the throwaway VPS 2026-09-01: 19:46:39 MCC wrote the config,
// 19:47:34 the gateway stopped coming up, and systemd restart-looped to counter
// 132 before it was stopped by hand.
//
// The trap is that "installed" is not "consented" — OpenClaw's own startup
// repair npm-installs the configured-but-missing plugin, so the npm project dir
// (~/.openclaw/npm/projects/openclaw-memory-lancedb-*) exists while the plugin
// is still absent from `plugins list` and still blocks startup. The dir check
// the wiki setup used would have waved this through.

vi.mock('@/lib/db', () => ({ db: {} }))

function probe(over: Partial<PluginProbe> = {}): PluginProbe {
  return {
    listed: vi.fn(async () => false),
    available: vi.fn(async () => true),
    install: vi.fn(async () => 0),
    ...over,
  }
}

describe('requiredExternalPlugin', () => {
  it('agent purpose needs the external memory-lancedb plugin', async () => {
    const { requiredExternalPlugin } = await import('@/lib/wiki/purpose')
    expect(requiredExternalPlugin('agent')).toEqual({
      id: 'memory-lancedb',
      pkg: '@openclaw/memory-lancedb',
    })
  })

  // memory-wiki ships with OpenClaw (stock:memory-wiki/index.js), so the
  // customer-service purpose has nothing to install and nothing to consent to.
  it('customer-service purpose needs no external plugin', async () => {
    const { requiredExternalPlugin } = await import('@/lib/wiki/purpose')
    expect(requiredExternalPlugin('customer-service')).toBeNull()
  })
})

describe('ensurePurposePlugins', () => {
  it('is a no-op when the plugin is already consented', async () => {
    const { ensurePurposePlugins } = await import('@/lib/wiki/purpose')
    const p = probe({ listed: vi.fn(async () => true) })
    expect(await ensurePurposePlugins('agent', p, () => {})).toBe(0)
    expect(p.install).not.toHaveBeenCalled()
  })

  it('installs with capability consent when the plugin is missing', async () => {
    const { ensurePurposePlugins } = await import('@/lib/wiki/purpose')
    const p = probe()
    expect(await ensurePurposePlugins('agent', p, () => {})).toBe(0)
    expect(p.install).toHaveBeenCalledWith('@openclaw/memory-lancedb')
  })

  // The whole point: a failed install must stop the caller BEFORE it writes
  // the enable-flag and restarts the gateway.
  it('reports failure when the install does not succeed', async () => {
    const { ensurePurposePlugins } = await import('@/lib/wiki/purpose')
    const p = probe({ install: vi.fn(async () => 1) })
    expect(await ensurePurposePlugins('agent', p, () => {})).not.toBe(0)
  })

  it('leaves older OpenClaw alone when it has no such plugin', async () => {
    const { ensurePurposePlugins } = await import('@/lib/wiki/purpose')
    const p = probe({ available: vi.fn(async () => false) })
    expect(await ensurePurposePlugins('agent', p, () => {})).toBe(0)
    expect(p.install).not.toHaveBeenCalled()
  })

  it('does not probe at all for the customer-service purpose', async () => {
    const { ensurePurposePlugins } = await import('@/lib/wiki/purpose')
    const p = probe()
    expect(await ensurePurposePlugins('customer-service', p, () => {})).toBe(0)
    expect(p.listed).not.toHaveBeenCalled()
    expect(p.install).not.toHaveBeenCalled()
  })
})
