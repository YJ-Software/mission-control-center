import { createHash } from 'crypto'

/**
 * Reduce a news link to a stable identity so the same article can't be counted
 * twice under different dressing.
 *
 * The dedup ledger keys off the hash this produces, so the balance here
 * matters in both directions:
 *
 * - Normalise too little and `?utm_source=rss` makes a repeat look new, which
 *   is the whole problem being solved.
 * - Normalise too much and two genuinely different pages collapse into one —
 *   the report then silently drops a story. That is the worse failure, so the
 *   tracking-parameter list below is a conservative blocklist of parameters
 *   that are unambiguously analytics. A whitelist would be safer against
 *   over-collapsing but would strip `?id=123` and `?p=456`, which *are* the
 *   article.
 */

/** Exact parameter names that never affect which page you land on. */
const TRACKING_PARAMS = new Set([
  'gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'twclid', 'ttclid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'igshid', 'ref', 'ref_src', 'referrer',
  'at_medium', 'at_campaign', 'xtor', 'ncid', 'cmpid', 'sr_share', 'guccounter',
])

/** Prefixes covering whole families (utm_source, utm_campaign, …). */
const TRACKING_PREFIXES = ['utm_', 'pk_', 'piwik_', 'matomo_']

function isTrackingParam(name: string): boolean {
  const k = name.toLowerCase()
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))
}

/**
 * Unwrap a Google redirect.
 *
 * Google Alerts hands out `https://www.google.com/url?rct=j&…&url=<real>&ct=ga`
 * rather than the article link. Left wrapped, every item carries its own
 * `ct`/`usg` values, so no two entries ever hash alike and dedup does nothing
 * at all.
 *
 * Note this deliberately does not touch `news.google.com/rss/articles/<blob>`:
 * that identifier is opaque and only resolves by following it over the
 * network, which is not this function's job. It is stable per article, so it
 * still dedups correctly against itself.
 */
function unwrapRedirect(raw: string): string {
  try {
    const u = new URL(raw)
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return raw
    if (u.pathname !== '/url') return raw
    const target = u.searchParams.get('url') || u.searchParams.get('q')
    if (!target) return raw
    // Wrappers occasionally nest (an alert linking a redirector).
    return unwrapRedirect(target)
  } catch {
    return raw
  }
}

export interface NormalizedUrl {
  /** Canonical form used for display and storage. */
  url: string
  /** Lowercased host with a leading `www.` removed. */
  host: string
  /** sha256 of `url` — the dedup key. */
  hash: string
  /** The input, kept for debugging when unwrapping misfires. */
  raw: string
}

/** Returns null for anything that isn't a usable http(s) URL. */
export function normalizeUrl(raw: string): NormalizedUrl | null {
  if (!raw) return null

  // Markdown and prose leave punctuation stuck to the end of bare links.
  const trimmed = raw.trim().replace(/[).,;:!?'"\]]+$/, '')

  let u: URL
  try {
    u = new URL(unwrapRedirect(trimmed))
  } catch {
    return null
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  // http and https serve the same article; treat them as one.
  u.protocol = 'https:'
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  u.hash = ''
  u.username = ''
  u.password = ''
  if ((u.port === '80' || u.port === '443')) u.port = ''

  for (const name of [...u.searchParams.keys()]) {
    if (isTrackingParam(name)) u.searchParams.delete(name)
  }
  // Parameter order is presentational; sorting makes two orderings agree.
  u.searchParams.sort()

  // "/path/" and "/path" are the same page, but "/" alone must stay.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '')
  }

  const url = u.toString()
  return {
    url,
    host: u.hostname,
    hash: createHash('sha256').update(url, 'utf8').digest('hex'),
    raw: trimmed,
  }
}

/**
 * Pull every http(s) link out of a markdown report.
 *
 * Matches markdown link targets and bare URLs alike, then normalises and
 * de-duplicates. Order is preserved so the first appearance wins.
 */
export function extractUrls(markdown: string): NormalizedUrl[] {
  const out: NormalizedUrl[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(/https?:\/\/[^\s<>)\]"'`]+/g)) {
    const n = normalizeUrl(match[0])
    if (!n || seen.has(n.hash)) continue
    seen.add(n.hash)
    out.push(n)
  }
  return out
}
