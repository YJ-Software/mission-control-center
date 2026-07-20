import { describe, it, expect, vi } from 'vitest'
import { allowPlugins } from '@/lib/plugins/allowlist'

/**
 * Regression: 2026-07 Telegram pairing broke with
 *   "Cannot enable Telegram: blocked by allowlist"
 * on boxes where a feature-setup flow (Search → tavily, Second-Brain → memory-*)
 * had populated `plugins.allow`. OpenClaw only enforces the allowlist when it is
 * NON-EMPTY, and it does not auto-add Telegram. So MCC's setup flows must never
 * (a) activate an inert allowlist, nor (b) drop an already-permitted plugin when
 * extending an active one.
 */
describe('allowPlugins', () => {
  it('does NOT activate an inert (absent) allowlist', () => {
    const cfg: Record<string, any> = { plugins: { entries: {} } }
    allowPlugins(cfg, ['tavily'])
    // Absent stays absent → allowlist inert → Telegram (and everything) permitted.
    expect(cfg.plugins.allow).toBeUndefined()
  })

  it('does NOT activate an inert (empty) allowlist', () => {
    const cfg: Record<string, any> = { plugins: { allow: [], entries: {} } }
    allowPlugins(cfg, ['tavily', 'memory-wiki'])
    // Empty stays empty — never flips enforcement on.
    expect(cfg.plugins.allow).toEqual([])
  })

  it('extends an active allowlist additively', () => {
    const cfg: Record<string, any> = { plugins: { allow: ['lossless-claw'] } }
    allowPlugins(cfg, ['memory-lancedb', 'memory-wiki'])
    expect(cfg.plugins.allow).toEqual(['lossless-claw', 'memory-lancedb', 'memory-wiki'])
  })

  it('preserves an already-permitted Telegram when extending', () => {
    const cfg: Record<string, any> = { plugins: { allow: ['lossless-claw', 'telegram'] } }
    allowPlugins(cfg, ['tavily'])
    // The whole point: extending the allowlist must not evict Telegram.
    expect(cfg.plugins.allow).toContain('telegram')
    expect(cfg.plugins.allow).toEqual(['lossless-claw', 'telegram', 'tavily'])
  })

  it('is idempotent — no duplicate ids', () => {
    const cfg: Record<string, any> = { plugins: { allow: ['lossless-claw', 'tavily'] } }
    allowPlugins(cfg, ['tavily'])
    expect(cfg.plugins.allow).toEqual(['lossless-claw', 'tavily'])
  })

  it('creates the plugins object when missing without activating an allowlist', () => {
    const cfg: Record<string, any> = {}
    allowPlugins(cfg, ['tavily'])
    expect(cfg.plugins).toBeDefined()
    expect(cfg.plugins.allow).toBeUndefined()
  })
})

/**
 * The real caller. applyPurposeToConfig used to do `allow ??= []; allow.push(…)`,
 * which activated an empty allowlist and thereby disabled Telegram. Verify the
 * fixed behaviour end-to-end. purpose.ts imports @/lib/db at module load, so we
 * stub it — applyPurposeToConfig itself never touches the DB.
 */
vi.mock('@/lib/db', () => ({ db: {} }))

describe('applyPurposeToConfig allowlist behaviour', () => {
  it('leaves an inert allowlist inert (Telegram stays permitted)', async () => {
    const { applyPurposeToConfig } = await import('@/lib/wiki/purpose')
    const cfg: Record<string, any> = {}
    applyPurposeToConfig(cfg, 'agent')
    // No allowlist materialised → nothing is blocked.
    const allow = cfg.plugins.allow
    expect(!Array.isArray(allow) || allow.length === 0).toBe(true)
  })

  it('does not evict Telegram from an active allowlist', async () => {
    const { applyPurposeToConfig } = await import('@/lib/wiki/purpose')
    const cfg: Record<string, any> = {
      plugins: { allow: ['lossless-claw', 'telegram'] },
    }
    applyPurposeToConfig(cfg, 'agent')
    expect(cfg.plugins.allow).toContain('telegram')
    expect(cfg.plugins.allow).toContain('memory-lancedb')
    expect(cfg.plugins.allow).toContain('memory-wiki')
  })

  it('still strips memory-core / memory-lancedb-pro from an active allowlist', async () => {
    const { applyPurposeToConfig } = await import('@/lib/wiki/purpose')
    const cfg: Record<string, any> = {
      plugins: { allow: ['lossless-claw', 'memory-core', 'memory-lancedb-pro'] },
    }
    applyPurposeToConfig(cfg, 'agent')
    expect(cfg.plugins.allow).not.toContain('memory-core')
    expect(cfg.plugins.allow).not.toContain('memory-lancedb-pro')
    expect(cfg.plugins.allow).toContain('lossless-claw')
  })
})
