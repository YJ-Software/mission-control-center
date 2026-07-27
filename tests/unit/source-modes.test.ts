import { describe, it, expect, vi } from 'vitest'

// buildSourceBlock is pure, but its module reaches @/lib/db at import.
vi.mock('@/lib/db', () => ({ db: {} }))

import { buildSourceBlock, type SourceMode } from '@/lib/morning-report/prompt-generator'
import type { CandidateRow } from '@/lib/morning-report/news-store'

/**
 * The block that decides what a topic is allowed to draw on. It is generated
 * rather than authored so it cannot drift out of step with the topic's
 * configured mode.
 */

const candidates: CandidateRow[] = [
  {
    url: 'https://udn.com/news/story/6811/9652070',
    host: 'udn.com',
    title: '黃仁勳喊「這次不一樣」',
    snippet: '晶片榮景短期持續',
    publishedAt: Math.floor(Date.parse('2026-07-26T10:00:00Z') / 1000),
  },
  {
    url: 'https://technews.tw/2026/07/26/ai-personality',
    host: 'technews.tw',
    title: 'AI 跑分不再是唯一',
    snippet: '模型的性格將決定勝負',
    publishedAt: null,
  },
]

const build = (mode: SourceMode, rows = candidates) => buildSourceBlock(mode, rows)

describe('buildSourceBlock', () => {
  it('emits nothing in search mode, so an unconfigured topic is untouched', () => {
    expect(build('search')).toBe('')
  })

  it('emits nothing when the sources produced no candidates', () => {
    // Better to leave the agent to search than to hand it an empty list and
    // tell it those are the only permitted sources.
    expect(build('feed', [])).toBe('')
    expect(build('feed+search', [])).toBe('')
  })

  it('lists every candidate with its address and provenance', () => {
    const block = build('feed+search')

    expect(block).toContain('黃仁勳喊「這次不一樣」')
    expect(block).toContain('https://udn.com/news/story/6811/9652070')
    expect(block).toContain('udn.com，2026-07-26')
    expect(block).toContain('AI 跑分不再是唯一')
    expect(block).toContain('共 2 則')
  })

  it('omits the date when the feed did not supply one', () => {
    expect(build('feed+search')).toContain('（technews.tw）')
  })

  it('lets the agent keep searching in feed+search mode', () => {
    const block = build('feed+search')

    expect(block).toContain('優先')
    expect(block).toContain('再自行搜尋補充')
    expect(block).not.toContain('不要自行搜尋')
  })

  it('forbids searching in feed mode', () => {
    expect(build('feed')).toContain('不要自行搜尋其他新聞')
  })

  it('still demands the agent open and read each link in feed mode', () => {
    // The failure this prevents: RSS carries a title and one sentence, so an
    // agent told only "use these sources" paraphrases the summary and calls it
    // a report.
    const block = build('feed')

    expect(block).toContain('必須實際開啟以下每一個連結、閱讀全文')
    expect(block).toContain('直接改寫摘要不算完成')
  })

  it('tells the agent what to do when the sources are too thin', () => {
    expect(build('feed')).toContain('素材不足')
  })

  it('falls back to the URL when a candidate has no title', () => {
    const untitled: CandidateRow = { ...candidates[0], title: '' }
    expect(build('feed', [untitled])).toContain(`- ${untitled.url}`)
  })
})

describe('feedIds contract', () => {
  it('spreading the raw column text is what produced the junk entries', () => {
    // The topic API used to hand feed_ids back as the raw column text. The
    // client spread it into its edit state, and [...'[]'] is ['[', ']'] —
    // which is how ["[", "]", "<id>"] came to be stored on a live install.
    // The API now parses before responding, and the client guards with
    // Array.isArray so a stale cached response cannot resurrect it.
    const fromApiBefore = '[]'
    expect([...fromApiBefore, 'feed-id']).toEqual(['[', ']', 'feed-id'])

    const fromApiAfter: string[] = []
    expect([...fromApiAfter, 'feed-id']).toEqual(['feed-id'])
  })
})
