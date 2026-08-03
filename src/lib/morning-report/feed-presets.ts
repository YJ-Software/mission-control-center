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
  group: 'tech' | 'world' | 'finance' | 'chinese' | 'chineseWorld' | 'research' | 'crypto' | 'social'
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

  { id: 'bbcWorld', group: 'world', label: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardianWorld', group: 'world', label: 'The Guardian World', url: 'https://www.theguardian.com/world/rss' },
  { id: 'aljazeera', group: 'world', label: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'npr', group: 'world', label: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },

  { id: 'cnbc', group: 'finance', label: 'CNBC Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'cnbcTech', group: 'finance', label: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html' },
  { id: 'marketwatch', group: 'finance', label: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },

  { id: 'technews', group: 'chinese', label: 'TechNews 科技新報', url: 'https://technews.tw/feed/' },
  { id: 'ithome', group: 'chinese', label: 'iThome', url: 'https://www.ithome.com.tw/rss' },
  { id: 'cna', group: 'chinese', label: '中央社 科技', url: 'https://feeds.feedburner.com/rsscna/technology' },

  { id: 'bbcZh', group: 'chineseWorld', label: 'BBC 中文', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml' },
  { id: 'cnaWorld', group: 'chineseWorld', label: '中央社 國際', url: 'https://feeds.feedburner.com/rsscna/intworld' },
  { id: 'cnaFinance', group: 'chineseWorld', label: '中央社 財經', url: 'https://feeds.feedburner.com/rsscna/finance' },
  { id: 'pts', group: 'chineseWorld', label: '公視新聞', url: 'https://news.pts.org.tw/xml/newsfeed.xml' },
  { id: 'ltn', group: 'chineseWorld', label: '自由時報', url: 'https://news.ltn.com.tw/rss/all.xml' },
  { id: 'cnyes', group: 'chineseWorld', label: '鉅亨網', url: 'https://news.cnyes.com/rss/v1/news/category/headline' },

  { id: 'arxivAI', group: 'research', label: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI' },
  { id: 'arxivCL', group: 'research', label: 'arXiv cs.CL', url: 'http://export.arxiv.org/rss/cs.CL' },
  { id: 'producthunt', group: 'research', label: 'Product Hunt', url: 'https://www.producthunt.com/feed' },
  // GitHub publishes no feed for its trending page — /trending.atom answers 406
  // — so this is a third-party generator that scrapes it into RSS daily. Listed
  // because it parsed clean (15 items, 15 distinct URLs, all github.com), but it
  // is one volunteer's GitHub Pages site: if it ever goes stale, drop it rather
  // than leaving a preset that quietly returns yesterday's list forever.
  { id: 'githubTrending', group: 'research', label: 'GitHub Trending', url: 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml' },

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

export const PRESET_GROUPS = [
  'tech', 'world', 'finance', 'chinese', 'chineseWorld', 'research', 'crypto', 'social',
] as const
