import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The citation ledger that replaced the old tmp/-scanning dedup.
 *
 * `@/lib/db` opens ~/.mission-control/db.sqlite at import with no override, so
 * these tests run against a throwaway file instead of the operator's database.
 */

const { tmpDbPath } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return { tmpDbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-news-')), 'db.sqlite') }
})

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('@/lib/schema')
  const sqlite = new Database(tmpDbPath)
  // Mirrors the DDL in src/lib/db.ts.
  sqlite.exec(`
    CREATE TABLE news_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url_hash TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      raw_url TEXT,
      host TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      snippet TEXT DEFAULT '',
      simhash TEXT,
      source TEXT NOT NULL DEFAULT 'report',
      feed_id TEXT,
      published_at INTEGER,
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
      used_in_report TEXT
    );
  `)
  return { db: drizzle(sqlite, { schema }), initDb: () => {} }
})

import {
  recordCitedUrls,
  getRecentlyCitedUrls,
  wasCitedRecently,
  pruneNewsArticles,
  backfillCitedUrlsFromReports,
} from '@/lib/morning-report/news-store'
import { db } from '@/lib/db'
import { newsArticles } from '@/lib/schema'
import { normalizeUrl } from '@/lib/morning-report/url-normalize'

const dir = mkdtempSync(join(tmpdir(), 'mcc-news-md-'))

function report(markdown: string): string {
  const p = join(dir, `report-${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(p, markdown)
  return p
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Insert a row directly, for seeding dates the public API can't set. */
function seed(url: string, opts: { usedInReport?: string; fetchedAt?: number } = {}) {
  const n = normalizeUrl(url)!
  db.insert(newsArticles).values({
    urlHash: n.hash,
    url: n.url,
    host: n.host,
    source: 'google-alerts',
    usedInReport: opts.usedInReport ?? null,
    ...(opts.fetchedAt ? { fetchedAt: opts.fetchedAt } : {}),
  }).run()
}

beforeEach(() => {
  db.delete(newsArticles).run()
})

describe('recordCitedUrls', () => {
  it('records every link a report cited', () => {
    const p = report('- [A](https://example.com/a)\n- [B](https://example.com/b)\n')

    expect(recordCitedUrls(p, '2026-07-26')).toEqual({ scanned: 2, recorded: 2 })
    expect(getRecentlyCitedUrls(30).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('counts one article once even when the report links it several ways', () => {
    const p = report(`
      https://example.com/a?utm_source=rss
      https://www.example.com/a/
      https://example.com/a#top
    `)

    expect(recordCitedUrls(p, '2026-07-26').recorded).toBe(1)
  })

  it('marks an existing candidate as used instead of duplicating it', () => {
    // This is the RSS-intake path: the article was fetched as a candidate
    // first, then chosen by the agent.
    seed('https://example.com/a')
    const p = report('https://example.com/a')

    recordCitedUrls(p, '2026-07-26')

    const rows = db.select().from(newsArticles).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].usedInReport).toBe('2026-07-26')
    // The row keeps where it came from rather than being overwritten as 'report'.
    expect(rows[0].source).toBe('google-alerts')
  })

  it('keeps the first citation date when a link resurfaces', () => {
    // "When did we already run this" is the useful answer, not "when last".
    const p = report('https://example.com/a')
    recordCitedUrls(p, '2026-07-20')
    recordCitedUrls(p, '2026-07-26')

    expect(db.select().from(newsArticles).all()[0].usedInReport).toBe('2026-07-20')
  })

  it('survives a report file that is not there', () => {
    expect(recordCitedUrls(join(dir, 'nope.md'), '2026-07-26')).toEqual({ scanned: 0, recorded: 0 })
  })

  it('records nothing for a report with no links', () => {
    expect(recordCitedUrls(report('# 晨報\n\n今日無新聞。'), '2026-07-26'))
      .toEqual({ scanned: 0, recorded: 0 })
  })
})

describe('getRecentlyCitedUrls', () => {
  it('returns only citations inside the window', () => {
    seed('https://example.com/recent', { usedInReport: daysAgo(3) })
    seed('https://example.com/old', { usedInReport: daysAgo(40) })

    expect(getRecentlyCitedUrls(14)).toEqual(['https://example.com/recent'])
  })

  it('ignores candidates that were never cited', () => {
    seed('https://example.com/candidate')

    expect(getRecentlyCitedUrls(14)).toEqual([])
  })

  it('returns nothing for a non-positive window', () => {
    seed('https://example.com/a', { usedInReport: daysAgo(1) })

    expect(getRecentlyCitedUrls(0)).toEqual([])
    expect(getRecentlyCitedUrls(-5)).toEqual([])
  })
})

describe('wasCitedRecently', () => {
  it('matches through normalisation, not raw string equality', () => {
    seed('https://example.com/a', { usedInReport: daysAgo(2) })

    // The same article as an agent would encounter it in an alert feed.
    expect(wasCitedRecently('https://www.example.com/a/?utm_source=rss', 14)).toBe(true)
    expect(wasCitedRecently('https://www.google.com/url?url=https://example.com/a&ct=ga', 14)).toBe(true)
  })

  it('is false outside the window and for unknown links', () => {
    seed('https://example.com/old', { usedInReport: daysAgo(40) })

    expect(wasCitedRecently('https://example.com/old', 14)).toBe(false)
    expect(wasCitedRecently('https://example.com/never-seen', 14)).toBe(false)
  })
})

describe('pruneNewsArticles', () => {
  it('keeps recent citations and drops ancient ones', () => {
    seed('https://example.com/keep', { usedInReport: daysAgo(100) })
    seed('https://example.com/drop', { usedInReport: daysAgo(400) })

    pruneNewsArticles()

    expect(db.select().from(newsArticles).all().map((r) => r.url))
      .toEqual(['https://example.com/keep'])
  })

  it('expires unused candidates far sooner than citations', () => {
    const sixtyDaysAgo = Math.floor(Date.now() / 1000) - 60 * 86400
    seed('https://example.com/stale-candidate', { fetchedAt: sixtyDaysAgo })
    seed('https://example.com/old-citation', { usedInReport: daysAgo(60), fetchedAt: sixtyDaysAgo })

    pruneNewsArticles()

    expect(db.select().from(newsArticles).all().map((r) => r.url))
      .toEqual(['https://example.com/old-citation'])
  })
})

describe('backfillCitedUrlsFromReports', () => {
  /** A tmp dir holding reports named the way the pipeline writes them. */
  function reportDir(files: Record<string, string>): string {
    const d = mkdtempSync(join(tmpdir(), 'mcc-backfill-'))
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body)
    return d
  }

  const stamp = (daysBack: number) => {
    const dt = new Date()
    dt.setDate(dt.getDate() - daysBack)
    return dt.toISOString().slice(0, 10).replace(/-/g, '')
  }

  it('seeds an empty ledger from reports the old mechanism left behind', () => {
    // Without this, the first report after upgrading has no dedup memory and
    // can repeat yesterday's stories — a regression caused by the upgrade.
    const d = reportDir({
      [`morning-report-ai-${stamp(1)}.md`]: 'see https://example.com/a',
      [`morning-report-${stamp(1)}.md`]: 'merged https://example.com/b',
    })

    expect(backfillCitedUrlsFromReports(d, 14)).toBeGreaterThan(0)
    expect(getRecentlyCitedUrls(14).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('runs once — a ledger with anything in it is left alone', () => {
    seed('https://example.com/already', { usedInReport: daysAgo(1) })
    const d = reportDir({ [`morning-report-ai-${stamp(1)}.md`]: 'https://example.com/new' })

    expect(backfillCitedUrlsFromReports(d, 14)).toBe(0)
    expect(getRecentlyCitedUrls(14)).toEqual(['https://example.com/already'])
  })

  it('ignores reports older than the window', () => {
    const d = reportDir({
      [`morning-report-ai-${stamp(2)}.md`]: 'https://example.com/recent',
      [`morning-report-ai-${stamp(90)}.md`]: 'https://example.com/ancient',
    })

    backfillCitedUrlsFromReports(d, 14)
    expect(getRecentlyCitedUrls(14)).toEqual(['https://example.com/recent'])
  })

  it('attributes each link to the date in its filename', () => {
    const d = reportDir({ [`morning-report-ai-${stamp(3)}.md`]: 'https://example.com/x' })

    backfillCitedUrlsFromReports(d, 14)
    const expected = new Date()
    expected.setDate(expected.getDate() - 3)
    expect(db.select().from(newsArticles).all()[0].usedInReport)
      .toBe(expected.toISOString().slice(0, 10))
  })

  it('survives a directory that is not there', () => {
    expect(backfillCitedUrlsFromReports(join(dir, 'nope'), 14)).toBe(0)
  })
})
