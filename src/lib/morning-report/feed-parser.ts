import { XMLParser } from 'fast-xml-parser'
import { normalizeUrl, type NormalizedUrl } from './url-normalize'

/**
 * Turn an RSS 2.0 or Atom document into article candidates.
 *
 * Google Alerts serves Atom; most other sources serve RSS. Rather than
 * detecting the flavour up front, this reads whichever container is present —
 * a feed that mixes them, or wraps them unusually, still yields what it has.
 *
 * Everything here is third-party input, so nothing is trusted: entries missing
 * a usable link are dropped, titles are stripped of the markup Google embeds
 * to highlight matched terms, and every URL goes through normalizeUrl (which
 * validates via `new URL` and rejects non-http schemes).
 */

export interface FeedItem {
  url: NormalizedUrl
  title: string
  snippet: string
  /** Unix seconds, or null when the feed gave no usable date. */
  publishedAt: number | null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Feeds are inconsistent about whether a single child is a list; forcing
  // these to arrays removes a whole class of "sometimes an object" bugs.
  isArray: (name) => ['entry', 'item', 'link'].includes(name),
  // Titles legitimately contain digits-only text ("2026"); parsing those into
  // numbers would corrupt them.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

/** Decode one numeric character reference, leaving anything out of range as
 *  the empty string rather than throwing on hostile input. */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Collapse markup and entities down to display text. */
function toText(value: unknown): string {
  if (value == null) return ''
  const raw = typeof value === 'object'
    ? String((value as Record<string, unknown>)['#text'] ?? '')
    : String(value)
  return raw
    // Block boundaries are real separators — without a space, "<p>a</p><p>b</p>"
    // would read as one word.
    .replace(/<\/?(?:p|div|br|li|tr|td|h[1-6]|blockquote|section)\b[^>]*>/gi, ' ')
    // Inline markup is not. Google wraps every matched term in <b>, so turning
    // those into spaces splits words apart — harmless in English, where the
    // spaces already exist, but it litters CJK text: 「人工智慧（<b>AI</b>）」
    // came out as 「人工智慧（ AI ）」 and went straight into the prompt.
    .replace(/<[^>]*>/g, '')
    // Numeric references first, and both forms of them: publishers emit
    // typographic punctuation this way rather than as named entities, so a
    // MarketWatch headline arrived reading "Nvidia&#x2019;s".
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last: decoding it earlier would let "&amp;lt;" become a real
    // "<" and re-enter the markup stripping above.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the article address.
 *
 * Atom puts it in a `href` attribute and may list several `<link>` elements
 * (alternate, self, hub…); RSS puts it in the element's text. Prefer an
 * explicitly alternate link, then the first usable one.
 */
function extractLink(entry: Record<string, unknown>): string {
  const links = entry.link
  if (Array.isArray(links)) {
    const usable = links.filter((l) => l && typeof l === 'object') as Record<string, unknown>[]
    const alternate = usable.find((l) => !l['@rel'] || l['@rel'] === 'alternate')
    const href = (alternate ?? usable[0])?.['@href']
    if (typeof href === 'string' && href) return href
    // RSS <link>text</link> arrives as a bare string inside the array.
    const text = links.find((l) => typeof l === 'string' && l)
    if (typeof text === 'string') return text
  }
  if (typeof links === 'string') return links
  // Some feeds only carry a guid that happens to be the permalink.
  const guid = entry.guid
  if (typeof guid === 'string' && /^https?:\/\//.test(guid)) return guid
  return ''
}

function extractDate(entry: Record<string, unknown>): number | null {
  for (const key of ['published', 'pubDate', 'updated', 'dc:date']) {
    const raw = entry[key]
    if (!raw) continue
    const ms = Date.parse(typeof raw === 'object' ? toText(raw) : String(raw))
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  return null
}

/** Parse a feed document. Returns [] for anything unparseable rather than
 *  throwing — one bad feed must not take down a fetch cycle. */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml) as Record<string, unknown>
  } catch {
    return []
  }

  const feed = (doc.feed ?? {}) as Record<string, unknown>
  const channel = ((doc.rss as Record<string, unknown>)?.channel
    ?? doc.channel
    ?? {}) as Record<string, unknown>

  const entries = [
    ...(Array.isArray(feed.entry) ? feed.entry : []),
    ...(Array.isArray(channel.item) ? channel.item : []),
    ...(Array.isArray(doc.item) ? doc.item : []),
  ] as Record<string, unknown>[]

  const items: FeedItem[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const url = normalizeUrl(extractLink(entry))
    // An entry with no resolvable article link is not a candidate.
    if (!url || seen.has(url.hash)) continue
    seen.add(url.hash)

    items.push({
      url,
      title: toText(entry.title),
      snippet: toText(entry.content ?? entry.summary ?? entry.description).slice(0, 500),
      publishedAt: extractDate(entry),
    })
  }

  return items
}
