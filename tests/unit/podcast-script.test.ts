import { describe, it, expect } from 'vitest'
import { parsePodcastScript } from '@/lib/morning-report/template-helpers'

describe('parsePodcastScript', () => {
  it('extracts intro / transition / outro by heading', () => {
    const script = `
## 開場白
大家早安，今天是 2026-04-15。

## 轉場
接下來我們看下一則新聞。

## 結語
以上就是今日晨報。
`
    const parsed = parsePodcastScript(script)
    expect(parsed.intro).toBe('大家早安，今天是 2026-04-15。')
    expect(parsed.transition).toBe('接下來我們看下一則新聞。')
    expect(parsed.outro).toBe('以上就是今日晨報。')
  })

  it('returns empty strings for missing sections', () => {
    const parsed = parsePodcastScript('## 開場白\nhi')
    expect(parsed.intro).toBe('hi')
    expect(parsed.transition).toBe('')
    expect(parsed.outro).toBe('')
  })

  it('ignores content before any heading', () => {
    const parsed = parsePodcastScript('stray content\n## 開場白\nhello')
    expect(parsed.intro).toBe('hello')
  })

  it('preserves multi-line bodies', () => {
    const parsed = parsePodcastScript(`## 開場白
line one
line two

line four
## 結語
end`)
    expect(parsed.intro).toBe('line one\nline two\n\nline four')
    expect(parsed.outro).toBe('end')
  })
})
