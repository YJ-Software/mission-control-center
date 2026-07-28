import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { newsArticles } from '@/lib/schema'
import { sql } from 'drizzle-orm'
import { extractUrls, normalizeUrl } from './url-normalize'

/**
 * The dedup ledger.
 *
 * Every URL a report actually cites is written back here, whatever found it —
 * an agent's own web search or a future RSS intake. That write-back is what
 * makes dedup durable: it no longer depends on yesterday's files still sitting
 * in tmp/, and it survives any change to where candidates come from.
 */

/** How long a citation stays worth remembering. */
const CITED_RETENTION_DAYS = 365
/** Candidates nobody used go stale fast. */
const CANDIDATE_RETENTION_DAYS = 30

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export interface RecordCitedResult {
  scanned: number
  recorded: number
}

/**
 * Record every link in a finished report as cited on `dateHyphen`.
 *
 * Rows are upserted on the normalised-URL hash, so a link already sitting in
 * the table as an unused candidate is simply marked used rather than
 * duplicated. An already-cited row keeps its original date — the first time a
 * story ran is what matters when deciding whether it is a repeat.
 */
export function recordCitedUrls(markdownPath: string, dateHyphen: string): RecordCitedResult {
  if (!existsSync(markdownPath)) return { scanned: 0, recorded: 0 }

  let urls: ReturnType<typeof extractUrls>
  try {
    urls = extractUrls(readFileSync(markdownPath, 'utf-8'))
  } catch (err) {
    console.warn('[news-store] could not read report:', (err as Error).message)
    return { scanned: 0, recorded: 0 }
  }

  let recorded = 0
  for (const u of urls) {
    try {
      db.insert(newsArticles)
        .values({
          urlHash: u.hash,
          url: u.url,
          rawUrl: u.raw === u.url ? null : u.raw,
          host: u.host,
          source: 'report',
          usedInReport: dateHyphen,
        })
        .onConflictDoUpdate({
          target: newsArticles.urlHash,
          set: { usedInReport: sql`COALESCE(${newsArticles.usedInReport}, excluded.used_in_report)` },
        })
        .run()
      recorded++
    } catch (err) {
      // One malformed link must not cost the rest of the ledger.
      console.warn('[news-store] could not record', u.url, (err as Error).message)
    }
  }

  return { scanned: urls.length, recorded }
}

/**
 * URLs cited within the last `days` days, for the prompt's do-not-repeat block.
 *
 * Replaces a scan of yesterday's files in tmp/, which saw one day back and
 * broke whenever those files were cleaned up.
 */
export function getRecentlyCitedUrls(days: number): string[] {
  if (days <= 0) return []
  const cutoff = daysAgo(days)
  try {
    const rows = db.all<{ url: string }>(sql`
      SELECT url FROM news_articles
       WHERE used_in_report IS NOT NULL AND used_in_report >= ${cutoff}
       ORDER BY used_in_report DESC, id DESC
    `)
    return rows.map((r) => r.url)
  } catch (err) {
    console.warn('[news-store] could not read cited urls:', (err as Error).message)
    return []
  }
}

/** True when this URL has already been cited within the window. */
export function wasCitedRecently(rawUrl: string, days: number): boolean {
  const n = normalizeUrl(rawUrl)
  if (!n) return false
  const cutoff = daysAgo(days)
  const row = db.get<{ n: number }>(sql`
    SELECT 1 AS n FROM news_articles
     WHERE url_hash = ${n.hash}
       AND used_in_report IS NOT NULL AND used_in_report >= ${cutoff}
     LIMIT 1
  `)
  return !!row
}

export interface CandidateRow {
  url: string
  host: string
  title: string
  snippet: string
  publishedAt: number | null
}

/**
 * Unused candidates from a topic's linked feeds, newest first.
 *
 * Excludes anything already cited: the point of offering candidates is to give
 * the agent material it hasn't run before, so a repeat must never be presented
 * as a suggestion in the first place.
 */
export function getCandidatesForFeeds(
  feedIds: string[],
  opts: { limit: number; withinDays: number },
): CandidateRow[] {
  if (feedIds.length === 0) return []
  const since = Math.floor(Date.now() / 1000) - opts.withinDays * 86400
  try {
    return db.all<CandidateRow>(sql`
      SELECT url, host, title, snippet, published_at AS publishedAt
        FROM news_articles
       WHERE used_in_report IS NULL
         AND feed_id IN (${sql.join(feedIds.map((id) => sql`${id}`), sql`, `)})
         AND COALESCE(published_at, fetched_at) >= ${since}
       ORDER BY COALESCE(published_at, fetched_at) DESC
       LIMIT ${opts.limit}
    `)
  } catch (err) {
    console.warn('[news-store] could not read candidates:', (err as Error).message)
    return []
  }
}

/**
 * Seed the ledger from reports already on disk, once.
 *
 * On an existing install the ledger starts empty, so the first report after
 * upgrading would go out with no dedup memory at all and could repeat
 * yesterday's stories — a visible regression caused purely by the upgrade.
 *
 * The files the old mechanism read are still there, so they are read once and
 * folded in. Runs only when the ledger has no citations at all: after that the
 * write-back keeps it current, and re-running would just re-add rows that
 * retention is meant to expire.
 */
export function backfillCitedUrlsFromReports(tmpDir: string, days = 14): number {
  try {
    const existing = db.get<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM news_articles WHERE used_in_report IS NOT NULL
    `)
    if ((existing?.n ?? 0) > 0) return 0
    if (!existsSync(tmpDir)) return 0

    const cutoff = daysAgo(days)
    let total = 0
    // morning-report-<topic>-yyyyMMdd.md and the merged morning-report-yyyyMMdd.md
    for (const file of readdirSync(tmpDir)) {
      const m = file.match(/^morning-report-(?:[a-z0-9_-]+-)?(\d{4})(\d{2})(\d{2})\.md$/i)
      if (!m) continue
      const date = `${m[1]}-${m[2]}-${m[3]}`
      if (date < cutoff) continue
      total += recordCitedUrls(join(tmpDir, file), date).recorded
    }
    if (total > 0) {
      console.log(`[news-store] seeded ledger with ${total} link(s) from existing reports`)
    }
    return total
  } catch (err) {
    console.warn('[news-store] backfill failed:', (err as Error).message)
    return 0
  }
}

/** Drop rows past their retention window. Cited links are kept far longer —
 *  they are the ledger; unused candidates are just stale inventory. */
export function pruneNewsArticles(): void {
  try {
    db.run(sql`
      DELETE FROM news_articles
       WHERE used_in_report IS NOT NULL AND used_in_report < ${daysAgo(CITED_RETENTION_DAYS)}
    `)
    const candidateCutoff = Math.floor(Date.now() / 1000) - CANDIDATE_RETENTION_DAYS * 86400
    db.run(sql`
      DELETE FROM news_articles
       WHERE used_in_report IS NULL AND fetched_at < ${candidateCutoff}
    `)
  } catch (err) {
    console.warn('[news-store] prune failed:', (err as Error).message)
  }
}
