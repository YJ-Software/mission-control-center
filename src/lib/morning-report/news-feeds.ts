import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { newsFeeds, newsArticles } from '@/lib/schema'
import { eq, sql } from 'drizzle-orm'
import { parseFeed } from './feed-parser'

/**
 * Registered news sources and the fetch that turns them into candidates.
 *
 * A Google Alerts feed URL needs no authentication — whoever holds it can read
 * the operator's alerts and, from the account id in the path, enumerate more.
 * It is a credential in URL form. Nothing here returns one in full except the
 * single-feed read used to populate the edit box.
 */

const FETCH_TIMEOUT_MS = 20_000
/** Bound on a single feed's contribution, so one noisy source can't flood the
 *  candidate pool or a prompt. */
const MAX_ITEMS_PER_FETCH = 100

export interface FeedRow {
  id: string
  label: string
  url: string
  enabled: number
  lastFetchedAt: number | null
  lastStatus: string | null
  lastError: string | null
  lastItemCount: number | null
  createdAt: number
}

/**
 * Hide all but enough of a feed URL to recognise it.
 *
 * Google Alerts: https://www.google.com/alerts/feeds/<account>/<feed>
 * Both trailing segments identify the operator's account, so both are cut.
 */
export function maskFeedUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const masked = parts.map((p, i) => (i >= parts.length - 2 && p.length > 4 ? '••••' : p))
    return `${u.origin}/${masked.join('/')}`
  } catch {
    return '••••'
  }
}

export function listFeeds(): FeedRow[] {
  return db.select().from(newsFeeds).orderBy(newsFeeds.createdAt).all() as FeedRow[]
}

/** Listing shape for the UI — never carries a usable feed address. */
export function listFeedsMasked(): (Omit<FeedRow, 'url'> & { urlMasked: string })[] {
  return listFeeds().map(({ url, ...rest }) => ({ ...rest, urlMasked: maskFeedUrl(url) }))
}

export function getFeed(id: string): FeedRow | undefined {
  return db.select().from(newsFeeds).where(eq(newsFeeds.id, id)).get() as FeedRow | undefined
}

export function createFeed(input: { label: string; url: string; enabled?: boolean }): FeedRow {
  const id = randomUUID()
  db.insert(newsFeeds).values({
    id,
    label: input.label.trim() || '未命名來源',
    url: input.url.trim(),
    enabled: input.enabled === false ? 0 : 1,
  }).run()
  return getFeed(id)!
}

export function updateFeed(
  id: string,
  fields: { label?: string; url?: string; enabled?: boolean },
): void {
  const update: Record<string, unknown> = {}
  if (fields.label !== undefined) update.label = fields.label.trim()
  // An empty url means "leave it alone" — the edit form sends the masked value
  // back when the operator didn't retype the address.
  if (fields.url) update.url = fields.url.trim()
  if (fields.enabled !== undefined) update.enabled = fields.enabled ? 1 : 0
  if (Object.keys(update).length === 0) return
  db.update(newsFeeds).set(update).where(eq(newsFeeds.id, id)).run()
}

export function deleteFeed(id: string): void {
  db.delete(newsFeeds).where(eq(newsFeeds.id, id)).run()
  // Candidates that were never used lose their meaning without the source;
  // anything already cited stays, because the ledger must not forget.
  db.run(sql`DELETE FROM news_articles WHERE feed_id = ${id} AND used_in_report IS NULL`)
}

export interface FetchResult {
  feedId: string
  label: string
  ok: boolean
  items: number
  /** Rows actually inserted — the rest were already known. */
  added: number
  error?: string
}

/** Fetch one feed and fold its entries into the candidate pool. */
export async function fetchFeed(feed: FeedRow): Promise<FetchResult> {
  const base = { feedId: feed.id, label: feed.label }
  let items: ReturnType<typeof parseFeed> = []

  try {
    const res = await fetch(feed.url, {
      headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    items = parseFeed(await res.text()).slice(0, MAX_ITEMS_PER_FETCH)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    db.update(newsFeeds)
      .set({ lastFetchedAt: Math.floor(Date.now() / 1000), lastStatus: 'error', lastError: error })
      .where(eq(newsFeeds.id, feed.id))
      .run()
    return { ...base, ok: false, items: 0, added: 0, error }
  }

  let added = 0
  for (const item of items) {
    try {
      const before = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM news_articles WHERE url_hash = ${item.url.hash}`)
      db.insert(newsArticles)
        .values({
          urlHash: item.url.hash,
          url: item.url.url,
          rawUrl: item.url.raw === item.url.url ? null : item.url.raw,
          host: item.url.host,
          title: item.title,
          snippet: item.snippet,
          source: 'google-alerts',
          feedId: feed.id,
          publishedAt: item.publishedAt,
        })
        // Already known — whether as an earlier candidate or a past citation.
        // Leave the existing row alone; its used_in_report is the ledger.
        .onConflictDoNothing({ target: newsArticles.urlHash })
        .run()
      if ((before?.n ?? 0) === 0) added++
    } catch (err) {
      console.warn('[news-feeds] could not store item:', (err as Error).message)
    }
  }

  db.update(newsFeeds)
    .set({
      lastFetchedAt: Math.floor(Date.now() / 1000),
      lastStatus: 'ok',
      lastError: null,
      lastItemCount: items.length,
    })
    .where(eq(newsFeeds.id, feed.id))
    .run()

  return { ...base, ok: true, items: items.length, added }
}

/** Fetch every enabled feed. Failures are reported, never thrown — a dead
 *  source must not stop the others or the pipeline that called this. */
export async function fetchAllFeeds(): Promise<FetchResult[]> {
  const feeds = listFeeds().filter((f) => f.enabled === 1)
  const results: FetchResult[] = []
  for (const feed of feeds) {
    results.push(await fetchFeed(feed))
  }
  return results
}

/**
 * Read a feed without storing anything, for the "test this address" button.
 * Returns a few entries so the operator can see it resolved to real articles.
 */
export async function previewFeed(url: string, limit = 5) {
  const res = await fetch(url, {
    headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const items = parseFeed(await res.text())
  return {
    total: items.length,
    items: items.slice(0, limit).map((i) => ({
      title: i.title,
      url: i.url.url,
      host: i.url.host,
      publishedAt: i.publishedAt,
    })),
  }
}
