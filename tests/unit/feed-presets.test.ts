import { describe, it, expect, vi } from 'vitest'
import { FEED_PRESETS, PRESET_GROUPS } from '@/lib/morning-report/feed-presets'

vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {} }))

import { assertPublicUrl } from '@/lib/morning-report/safe-fetch'

/**
 * A broken preset is worse than no preset: the operator has no reason to
 * doubt a suggestion the product made, so a dead entry reads as "my setup is
 * broken". These checks are what can be verified offline — the addresses were
 * each fetched and parsed for real before being listed.
 */

describe('FEED_PRESETS', () => {
  it('has no duplicate addresses', () => {
    const urls = FEED_PRESETS.map((p) => p.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('has no duplicate labels — the UI marks "already added" by label', () => {
    const labels = FEED_PRESETS.map((p) => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('has a unique id for every preset — the description is looked up by it', () => {
    const ids = FEED_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
  })

  it('only uses groups the UI renders', () => {
    for (const p of FEED_PRESETS) {
      expect(PRESET_GROUPS).toContain(p.group)
    }
  })

  it('fills every group, so none renders as an empty heading', () => {
    for (const g of PRESET_GROUPS) {
      expect(FEED_PRESETS.some((p) => p.group === g)).toBe(true)
    }
  })

  it('offers nothing the SSRF guard would refuse', async () => {
    // A preset that the product itself rejects on submit would be a
    // particularly confusing thing to suggest.
    for (const p of FEED_PRESETS) {
      await expect(assertPublicUrl(p.url), p.label).resolves.toBeInstanceOf(URL)
    }
  }, 30_000)

  it('does not offer Reddit, which rate-limits datacenter addresses', () => {
    // Two subreddits fetched back to back both returned 429 — including one
    // that had worked seconds earlier — so it would fail more often than not.
    for (const p of FEED_PRESETS) {
      expect(p.url).not.toContain('reddit.com')
    }
  })

  it('does not offer Google News keyword RSS', () => {
    // It needs no setup and returns plenty, which makes it tempting — but its
    // items link to opaque news.google.com ids that never resolve to the
    // publisher, so citations and dedup would both break.
    for (const p of FEED_PRESETS) {
      expect(p.url).not.toContain('news.google.com')
    }
  })
})
