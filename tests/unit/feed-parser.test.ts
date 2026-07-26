import { describe, it, expect, vi } from 'vitest'
import { parseFeed } from '@/lib/morning-report/feed-parser'

// news-feeds reaches @/lib/db, which opens ~/.mission-control/db.sqlite at
// import time. Nothing here touches the database, but a unit test has no
// business opening the operator's.
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {} }))

import { maskFeedUrl } from '@/lib/morning-report/news-feeds'

/**
 * Feeds are third-party input, so the parser has to survive the shapes real
 * sources emit — Atom from Google Alerts, RSS 2.0 from everything else — and
 * drop what it can't use rather than throwing.
 */

// Shaped after a real Google Alerts feed: Atom, links wrapped in the
// google.com/url redirector, <b> tags marking matched terms, CDATA content.
const GOOGLE_ALERTS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Google 快訊 - AI</title>
  <updated>2026-07-26T09:00:00Z</updated>
  <entry>
    <id>tag:google.com,2013:googlealerts/feed:1</id>
    <title type="html">Moonshot 發表 &lt;b&gt;Kimi K3&lt;/b&gt; 模型</title>
    <link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://example.com/kimi-k3&amp;ct=ga&amp;usg=ABC"/>
    <published>2026-07-26T08:30:00Z</published>
    <updated>2026-07-26T08:30:00Z</updated>
    <content type="html">2.8T 參數的 &lt;b&gt;開源&lt;/b&gt; 模型&amp;nbsp;正式發表</content>
  </entry>
  <entry>
    <id>tag:google.com,2013:googlealerts/feed:2</id>
    <title type="html">另一則新聞</title>
    <link href="https://www.google.com/url?rct=j&amp;url=https://other.example.org/story&amp;ct=ga"/>
    <published>2026-07-26T07:00:00Z</published>
    <content type="html">內容摘要</content>
  </entry>
</feed>`

const RSS_2 = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example News</title>
    <item>
      <title><![CDATA[標題含 CDATA & 特殊字元]]></title>
      <link>https://example.com/rss-a</link>
      <pubDate>Sat, 25 Jul 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>描述含 <em>HTML</em></p>]]></description>
    </item>
    <item>
      <title>第二則</title>
      <link>https://example.com/rss-b</link>
    </item>
  </channel>
</rss>`

describe('parseFeed — Google Alerts (Atom)', () => {
  it('unwraps the redirector so entries carry the real article URL', () => {
    // Without this every entry keeps its own ct/usg values and nothing ever
    // dedups against anything.
    const items = parseFeed(GOOGLE_ALERTS)

    expect(items).toHaveLength(2)
    expect(items[0].url.url).toBe('https://example.com/kimi-k3')
    expect(items[1].url.url).toBe('https://other.example.org/story')
  })

  it('strips the highlight markup Google injects into titles', () => {
    expect(parseFeed(GOOGLE_ALERTS)[0].title).toBe('Moonshot 發表 Kimi K3 模型')
  })

  it('reduces content to plain text', () => {
    expect(parseFeed(GOOGLE_ALERTS)[0].snippet).toBe('2.8T 參數的 開源 模型 正式發表')
  })

  it('reads the published date as unix seconds', () => {
    expect(parseFeed(GOOGLE_ALERTS)[0].publishedAt)
      .toBe(Math.floor(Date.parse('2026-07-26T08:30:00Z') / 1000))
  })
})

describe('parseFeed — RSS 2.0', () => {
  it('reads items whose link is element text rather than an attribute', () => {
    const items = parseFeed(RSS_2)

    expect(items.map((i) => i.url.url)).toEqual([
      'https://example.com/rss-a',
      'https://example.com/rss-b',
    ])
  })

  it('unwraps CDATA in titles and descriptions', () => {
    const [first] = parseFeed(RSS_2)

    expect(first.title).toBe('標題含 CDATA & 特殊字元')
    expect(first.snippet).toBe('描述含 HTML')
  })

  it('parses an RFC 822 pubDate', () => {
    expect(parseFeed(RSS_2)[0].publishedAt)
      .toBe(Math.floor(Date.parse('Sat, 25 Jul 2026 12:00:00 GMT') / 1000))
  })

  it('leaves publishedAt null when the feed gives no date', () => {
    expect(parseFeed(RSS_2)[1].publishedAt).toBeNull()
  })
})

describe('parseFeed — hostile and malformed input', () => {
  it('returns nothing rather than throwing on junk', () => {
    for (const bad of ['', 'not xml at all', '<feed><unclosed>', '{"json":true}']) {
      expect(parseFeed(bad)).toEqual([])
    }
  })

  it('drops entries with no usable link', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>沒有連結</title></entry>
      <entry><title>非 http</title><link href="javascript:alert(1)"/></entry>
      <entry><title>可用</title><link href="https://example.com/ok"/></entry>
    </feed>`

    expect(parseFeed(xml).map((i) => i.url.url)).toEqual(['https://example.com/ok'])
  })

  it('collapses entries that point at the same article', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>A</title><link href="https://example.com/a?utm_source=rss"/></entry>
      <entry><title>A 再一次</title><link href="https://www.example.com/a/"/></entry>
    </feed>`

    expect(parseFeed(xml)).toHaveLength(1)
  })

  it('prefers the alternate link when Atom lists several', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>多個 link</title>
        <link rel="self" href="https://example.com/feed.xml"/>
        <link rel="alternate" href="https://example.com/article"/>
      </entry>
    </feed>`

    expect(parseFeed(xml)[0].url.url).toBe('https://example.com/article')
  })

  it('falls back to a guid that is itself a permalink', () => {
    const xml = `<rss version="2.0"><channel>
      <item><title>只有 guid</title><guid>https://example.com/via-guid</guid></item>
    </channel></rss>`

    expect(parseFeed(xml)[0].url.url).toBe('https://example.com/via-guid')
  })

  it('keeps a numeric-looking title as text', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>2026</title><link href="https://example.com/y"/></entry>
    </feed>`

    expect(parseFeed(xml)[0].title).toBe('2026')
  })
})

describe('maskFeedUrl', () => {
  it('hides the account and feed ids that make the URL a credential', () => {
    // Anyone holding these two segments can read the operator's alerts.
    const masked = maskFeedUrl('https://www.google.com/alerts/feeds/12345678901234567890/9876543210')

    expect(masked).not.toContain('12345678901234567890')
    expect(masked).not.toContain('9876543210')
    expect(masked).toContain('alerts/feeds')
  })

  it('degrades safely for anything that is not a URL', () => {
    expect(maskFeedUrl('not a url')).toBe('••••')
  })
})
