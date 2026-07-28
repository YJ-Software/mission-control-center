/**
 * Ready-made feeds offered when adding a news source.
 *
 * Every entry here was fetched and parsed through this project's own feed
 * parser before being listed — a preset that 404s or returns something
 * unparseable is worse than no preset, because the operator has no reason to
 * doubt it and will assume their setup is broken.
 *
 * Deliberately absent: Google News keyword RSS
 * (news.google.com/rss/search?q=…). It needs no setup and returns plenty, but
 * every item links to an opaque news.google.com/rss/articles/<id> that does
 * not redirect to the publisher and cannot be decoded offline. The agent would
 * read Google News instead of the article, every citation would show the same
 * host, and dedup would fail because the same story carries a different id in
 * each feed. Google Alerts is the harder setup but wraps the real URL, which
 * this codebase unwraps.
 */

export interface FeedPreset {
  /** Stable key for the one-line description under sources.presetDesc. Kept
   *  separate from the label so the blurb can be translated while the source's
   *  own name stays as it is written. */
  id: string
  /** i18n key suffix under morningReport.sources.presetGroups */
  group: 'tech' | 'chinese' | 'research' | 'crypto' | 'social'
  label: string
  url: string
}

export const FEED_PRESETS: FeedPreset[] = [
  { id: 'hn', group: 'tech', label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { id: 'hnBest', group: 'tech', label: 'Hacker News (Best)', url: 'https://hnrss.org/best' },
  { id: 'techcrunch', group: 'tech', label: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { id: 'verge', group: 'tech', label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'ars', group: 'tech', label: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'mitTR', group: 'tech', label: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },

  { id: 'technews', group: 'chinese', label: 'TechNews 科技新報', url: 'https://technews.tw/feed/' },
  { id: 'ithome', group: 'chinese', label: 'iThome', url: 'https://www.ithome.com.tw/rss' },
  { id: 'cna', group: 'chinese', label: '中央社 科技', url: 'https://feeds.feedburner.com/rsscna/technology' },

  { id: 'arxivAI', group: 'research', label: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI' },
  { id: 'arxivCL', group: 'research', label: 'arXiv cs.CL', url: 'http://export.arxiv.org/rss/cs.CL' },
  { id: 'producthunt', group: 'research', label: 'Product Hunt', url: 'https://www.producthunt.com/feed' },

  { id: 'coindesk', group: 'crypto', label: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', group: 'crypto', label: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },

  { id: 'lobsters', group: 'social', label: 'Lobsters', url: 'https://lobste.rs/rss' },
]

/**
 * Reddit is not offered, though any subreddit exposes RSS by appending .rss.
 * From a datacenter address it answers 429 almost immediately — two subreddits
 * fetched back to back were already rate-limited, including one that had
 * succeeded seconds earlier, and a custom User-Agent made no difference. An
 * operator can still paste one; it just can't be a suggestion that mostly
 * fails.
 */

export const PRESET_GROUPS = ['tech', 'chinese', 'research', 'crypto', 'social'] as const
