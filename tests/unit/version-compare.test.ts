import { describe, it, expect } from 'vitest'
import { parseCliVersion, compareVersions, isUpdateAvailable } from '@/lib/version-compare'

const OPENCLAW_BANNER = 'OpenClaw 2026.7.1-2 (0790d9f) — One CLI to rule them all'

describe('parseCliVersion', () => {
  it('keeps the -N build counter OpenClaw appends', () => {
    // The old `[\d.]+` class stopped at the dash and yielded "2026.7.1", which
    // never equalled npm's "2026.7.1-2" — a permanent phantom update badge.
    expect(parseCliVersion(OPENCLAW_BANNER, 'OpenClaw')).toBe('2026.7.1-2')
  })

  it('ignores the commit hash and tagline that follow the version', () => {
    expect(parseCliVersion('OpenClaw 2026.5.5 (b1abf9d) — One CLI', 'OpenClaw')).toBe('2026.5.5')
  })

  it('parses a bare version with no banner', () => {
    expect(parseCliVersion('2026.5.5')).toBe('2026.5.5')
    expect(parseCliVersion('v1.7.3')).toBe('1.7.3')
  })

  it('handles plain semver and prerelease tags', () => {
    expect(parseCliVersion('opencli 1.2.3')).toBe('1.2.3')
    expect(parseCliVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1')
  })

  it('returns empty string when the command produced nothing usable', () => {
    expect(parseCliVersion('')).toBe('')
    expect(parseCliVersion('command not found')).toBe('')
  })
})

describe('compareVersions', () => {
  it('sorts a -N rebuild after the bare version', () => {
    expect(compareVersions('2026.7.1-2', '2026.7.1')).toBeGreaterThan(0)
    expect(compareVersions('2026.7.1', '2026.7.1-2')).toBeLessThan(0)
  })

  it('orders successive build counters', () => {
    // The old per-segment parseInt read both "1-2" and "1-3" as 1 and called
    // them equal, so a real -2 → -3 upgrade never surfaced.
    expect(compareVersions('2026.7.1-3', '2026.7.1-2')).toBeGreaterThan(0)
  })

  it('treats identical versions as equal', () => {
    expect(compareVersions('2026.7.1-2', '2026.7.1-2')).toBe(0)
    expect(compareVersions('0.3.76', '0.3.76')).toBe(0)
  })

  it('compares normal semver by segment, not lexically', () => {
    expect(compareVersions('0.3.76', '0.3.68')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2026.7.1', '2026.6.9')).toBeGreaterThan(0)
  })

  it('pads missing segments with zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })
})

describe('isUpdateAvailable', () => {
  it('is false when the installed build already matches npm', () => {
    expect(isUpdateAvailable('2026.7.1-2', '2026.7.1-2')).toBe(false)
  })

  it('is true for a newer build counter', () => {
    expect(isUpdateAvailable('2026.7.1-2', '2026.7.1-3')).toBe(true)
  })

  it('is false when either side is unknown — a failed lookup must not prompt', () => {
    expect(isUpdateAvailable('', '2026.7.1-2')).toBe(false)
    expect(isUpdateAvailable('2026.7.1-2', '')).toBe(false)
  })

  it('never offers a downgrade', () => {
    expect(isUpdateAvailable('2026.7.1-2', '2026.7.1')).toBe(false)
    expect(isUpdateAvailable('0.3.76', '0.3.68')).toBe(false)
  })

  it('reproduces the reported case end to end', () => {
    const installed = parseCliVersion(OPENCLAW_BANNER, 'OpenClaw')
    expect(isUpdateAvailable(installed, '2026.7.1-2')).toBe(false)
  })
})
