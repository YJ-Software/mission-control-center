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
  /** i18n key suffix under morningReport.sources.presetGroups */
  group: 'tech' | 'chinese' | 'research' | 'crypto' | 'social'
  label: string
  url: string
}

export const FEED_PRESETS: FeedPreset[] = [
  { group: 'tech', label: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { group: 'tech', label: 'Hacker News (Best)', url: 'https://hnrss.org/best' },
  { group: 'tech', label: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { group: 'tech', label: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { group: 'tech', label: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { group: 'tech', label: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },

  { group: 'chinese', label: 'TechNews 科技新報', url: 'https://technews.tw/feed/' },
  { group: 'chinese', label: 'iThome', url: 'https://www.ithome.com.tw/rss' },
  { group: 'chinese', label: '中央社 科技', url: 'https://feeds.feedburner.com/rsscna/technology' },

  { group: 'research', label: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI' },
  { group: 'research', label: 'arXiv cs.CL', url: 'http://export.arxiv.org/rss/cs.CL' },
  { group: 'research', label: 'Product Hunt', url: 'https://www.producthunt.com/feed' },

  { group: 'crypto', label: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { group: 'crypto', label: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },

  { group: 'social', label: 'Lobsters', url: 'https://lobste.rs/rss' },
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
