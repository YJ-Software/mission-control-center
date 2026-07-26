import { describe, it, expect } from 'vitest'
import { normalizeUrl, extractUrls } from '@/lib/morning-report/url-normalize'

/**
 * The dedup ledger keys off normalizeUrl's hash, so these cases pin both
 * directions of the tradeoff: links that are the same article must collapse,
 * and links that are different articles must not.
 */

const h = (s: string) => normalizeUrl(s)?.hash
const u = (s: string) => normalizeUrl(s)?.url

describe('normalizeUrl — Google redirects', () => {
  it('unwraps the Google Alerts wrapper', () => {
    // Left wrapped, each alert item carries its own ct/usg values, so nothing
    // ever hashes alike and dedup does nothing whatsoever.
    const wrapped = 'https://www.google.com/url?rct=j&sa=t&url=https://example.com/story-1&ct=ga&cd=abc&usg=XYZ'
    expect(u(wrapped)).toBe('https://example.com/story-1')
  })

  it('gives a wrapped and a bare link the same identity', () => {
    const wrapped = 'https://www.google.com/url?rct=j&sa=t&url=https://example.com/a&ct=ga&usg=Q'
    expect(h(wrapped)).toBe(h('https://example.com/a'))
  })

  it('unwraps a nested wrapper', () => {
    const inner = encodeURIComponent('https://example.com/deep')
    const nested = `https://www.google.com/url?url=${encodeURIComponent(`https://www.google.com/url?url=${inner}`)}`
    expect(u(nested)).toBe('https://example.com/deep')
  })

  it('leaves news.google.com article ids alone', () => {
    // The id is opaque and only resolves over the network. It is stable per
    // article, so it still dedups against itself.
    const g = 'https://news.google.com/rss/articles/CBMiK2h0dHBz'
    expect(u(g)).toBe(g)
  })

  it('does not treat an ordinary google.com page as a redirect', () => {
    expect(u('https://blog.google/technology/ai/some-post')).toBe('https://blog.google/technology/ai/some-post')
  })
})

describe('normalizeUrl — same article, different dressing', () => {
  it('strips utm_* campaign parameters', () => {
    expect(h('https://example.com/a?utm_source=rss&utm_medium=feed')).toBe(h('https://example.com/a'))
  })

  it('strips click ids', () => {
    for (const p of ['gclid=123', 'fbclid=abc', 'msclkid=xyz', 'igshid=q', 'ref=twitter']) {
      expect(h(`https://example.com/a?${p}`)).toBe(h('https://example.com/a'))
    }
  })

  it('ignores scheme, www and trailing slash', () => {
    const canonical = h('https://example.com/a')
    expect(h('http://example.com/a')).toBe(canonical)
    expect(h('https://www.example.com/a')).toBe(canonical)
    expect(h('https://example.com/a/')).toBe(canonical)
    expect(h('https://EXAMPLE.com/a')).toBe(canonical)
  })

  it('ignores the fragment', () => {
    expect(h('https://example.com/a#section-2')).toBe(h('https://example.com/a'))
  })

  it('ignores query parameter order', () => {
    expect(h('https://example.com/a?b=2&a=1')).toBe(h('https://example.com/a?a=1&b=2'))
  })

  it('drops punctuation that prose leaves stuck to a link', () => {
    expect(h('https://example.com/a).')).toBe(h('https://example.com/a'))
    expect(h('https://example.com/a,')).toBe(h('https://example.com/a'))
  })
})

describe('normalizeUrl — different articles must stay different', () => {
  it('keeps parameters that select the content', () => {
    // A whitelist approach would strip these and silently merge two stories.
    expect(h('https://example.com/news?id=123')).not.toBe(h('https://example.com/news?id=456'))
    expect(h('https://example.com/?p=1')).not.toBe(h('https://example.com/?p=2'))
  })

  it('keeps distinct paths and hosts apart', () => {
    expect(h('https://example.com/a')).not.toBe(h('https://example.com/b'))
    expect(h('https://a.com/x')).not.toBe(h('https://b.com/x'))
  })

  it('does not merge a subdomain into its parent', () => {
    expect(h('https://news.example.com/a')).not.toBe(h('https://example.com/a'))
  })
})

describe('normalizeUrl — rejects what is not a link', () => {
  it('returns null for junk, empty input and non-http schemes', () => {
    for (const bad of ['', '   ', 'not a url', 'ftp://example.com/a', 'javascript:alert(1)', 'mailto:a@b.c']) {
      expect(normalizeUrl(bad)).toBeNull()
    }
  })

  it('reports the host separately for grouping', () => {
    expect(normalizeUrl('https://www.Example.com/a')?.host).toBe('example.com')
  })
})

describe('extractUrls', () => {
  it('finds links in markdown and prose alike, de-duplicated', () => {
    const md = `
# 晨報

- [第一則](https://example.com/a?utm_source=rss)
- 第二則 https://example.com/b
- 重複的 https://www.example.com/a/
`
    const found = extractUrls(md)
    // a and a/ with utm are one article, so two remain.
    expect(found.map((f) => f.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('does not swallow the closing bracket of a markdown link', () => {
    expect(extractUrls('see [here](https://example.com/a) for more')[0].url)
      .toBe('https://example.com/a')
  })

  it('returns nothing for a report with no links', () => {
    expect(extractUrls('# 晨報\n\n今日無新聞。')).toEqual([])
  })
})
