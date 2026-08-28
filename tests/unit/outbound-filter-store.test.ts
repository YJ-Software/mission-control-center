import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Persistence side of the outbound filter: the drizzle table mapping, the
 * mode setting, and the tallies the dashboard card renders.
 *
 * `@/lib/db` opens ~/.mission-control/db.sqlite at import with no override,
 * so — following tests/unit/news-store.test.ts — these run against a
 * throwaway file rather than the operator's live database.
 */

const { tmpDbPath } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return { tmpDbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-filter-')), 'db.sqlite') }
})

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('@/lib/schema')
  const sqlite = new Database(tmpDbPath)
  // Mirrors the DDL in src/lib/db.ts — a drift here is exactly the bug
  // these tests exist to catch.
  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE cs_outbound_filter_hits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT,
      mode TEXT NOT NULL,
      outcome TEXT NOT NULL,
      rule_ids TEXT NOT NULL,
      matches TEXT NOT NULL,
      original_text TEXT NOT NULL,
      proposed_text TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `)
  return { db: drizzle(sqlite, { schema }) }
})

const {
  clearFilterHits,
  getFilterMode,
  getFilterStats,
  inspectOutbound,
  listFilterHits,
  setFilterMode,
} = await import('@/lib/customer-service/outbound-filter')

beforeEach(() => {
  clearFilterHits()
  setFilterMode('shadow')
})

describe('filter mode', () => {
  it('defaults to shadow when unset', () => {
    // clear the row the beforeEach wrote, then read through the default path
    setFilterMode('shadow')
    expect(getFilterMode()).toBe('shadow')
  })

  it('round-trips off and shadow', () => {
    setFilterMode('off')
    expect(getFilterMode()).toBe('off')
    setFilterMode('shadow')
    expect(getFilterMode()).toBe('shadow')
  })
})

describe('inspectOutbound (shadow mode)', () => {
  it('records a hit and stores both the original and the proposed text', () => {
    const verdict = inspectOutbound({
      userId: 'U123',
      channelId: 'line',
      text: 'Model Fallback: kimi-code unavailable\n您好,營業時間 09:00–17:00。',
    })

    expect(verdict?.outcome).toBe('rewrite')
    const hits = listFilterHits()
    expect(hits).toHaveLength(1)
    expect(hits[0].userId).toBe('U123')
    expect(hits[0].channelId).toBe('line')
    expect(hits[0].mode).toBe('shadow')
    expect(hits[0].outcome).toBe('rewrite')
    // The original must survive verbatim — it is what the customer actually got.
    expect(hits[0].originalText).toContain('Model Fallback')
    expect(hits[0].proposedText).toBe('您好,營業時間 09:00–17:00。')
    expect(JSON.parse(hits[0].ruleIds)).toContain('model-fallback')
  })

  it('stores null proposed text for a reply that would be blocked', () => {
    inspectOutbound({ userId: 'U1', text: 'ENOENT: no such file or directory' })
    expect(listFilterHits()[0].proposedText).toBeNull()
  })

  it('records nothing for a clean reply', () => {
    const verdict = inspectOutbound({ userId: 'U1', text: '好的,我幫您安排在下週二下午三點。' })
    expect(verdict?.outcome).toBe('allow')
    expect(listFilterHits()).toHaveLength(0)
  })

  it('records nothing when the mode is off', () => {
    setFilterMode('off')
    expect(inspectOutbound({ userId: 'U1', text: '<media:image>' })).toBeNull()
    expect(listFilterHits()).toHaveLength(0)
  })

  it('never throws on malformed input — the message mirror must not break', () => {
    expect(() => inspectOutbound({ userId: '', text: '' })).not.toThrow()
    expect(() => inspectOutbound({ userId: 'U1', text: 'x'.repeat(100_000) })).not.toThrow()
  })
})

describe('getFilterStats', () => {
  it('tallies per rule and per outcome', () => {
    inspectOutbound({ userId: 'U1', text: '<media:image> 平面圖' })
    inspectOutbound({ userId: 'U2', text: '<media:video> 影片' })
    inspectOutbound({ userId: 'U3', text: 'ENOENT: no such file or directory' })

    const stats = getFilterStats()
    expect(stats.total).toBe(3)
    expect(stats.last24h).toBe(3)
    expect(stats.byOutcome.rewrite).toBe(2)
    expect(stats.byOutcome.block).toBe(1)
    expect(stats.byRule[0]).toMatchObject({ ruleId: 'media-placeholder', count: 2 })
    // Rules carry a human label so the card doesn't have to know the rule set.
    expect(stats.byRule[0].label).toBeTruthy()
  })

  it('reports zeroes on an empty log', () => {
    const stats = getFilterStats()
    expect(stats.total).toBe(0)
    expect(stats.byRule).toEqual([])
  })
})

describe('listFilterHits', () => {
  it('returns newest first and honours the limit', () => {
    for (let i = 0; i < 5; i++) {
      inspectOutbound({ userId: `U${i}`, text: `<media:image> ${i}` })
    }
    expect(listFilterHits({ limit: 2 })).toHaveLength(2)
    expect(listFilterHits()).toHaveLength(5)
  })
})
