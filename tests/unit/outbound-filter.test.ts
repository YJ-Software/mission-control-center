import { describe, it, expect, vi } from 'vitest'

// evaluateOutbound is pure, but its module imports @/lib/db, which opens the
// operator's live ~/.mission-control/db.sqlite at import time. Stub it out —
// persistence is covered in outbound-filter-store.test.ts.
vi.mock('@/lib/db', () => ({ db: {} }))

const { evaluateOutbound, DEFAULT_RULES } = await import('@/lib/customer-service/outbound-filter')
type FilterRule = import('@/lib/customer-service/outbound-filter').FilterRule

/**
 * The shadow-mode rules exist to catch openclaw noise leaking to LINE
 * customers. The false-positive suite below matters more than the
 * true-positive one: a rule that eats a real answer is worse than one that
 * misses a banner, because in enforce mode the customer gets silence.
 */

describe('evaluateOutbound — real replies must pass untouched', () => {
  const REAL_REPLIES = [
    '您好,我們的營業時間是週一到週五 09:00–17:00,週末公休喔!',
    '這個方案一個月是 3,500 元,包含水電網路跟公共空間使用。要幫您安排參觀嗎?',
    '好的,我幫您記下來了。請問您的方便聯絡時間是什麼時候呢?',
    '不好意思,這部分我需要跟同事確認一下,稍後回覆您 🙏',
    '地址是台北市中山區XX路 100 號 3 樓,搭捷運到中山站步行約 5 分鐘。',
    'Hi! Our meeting rooms can be booked by the hour — NT$800 for a 4-person room.',
    '報價單我已經寄到您信箱了,主旨是「商務中心方案報價」,再麻煩您確認。',
    '目前 3 樓還有兩間空房,4 樓滿了。您希望什麼時候入住?',
  ]

  for (const reply of REAL_REPLIES) {
    it(`allows: ${reply.slice(0, 24)}…`, () => {
      const v = evaluateOutbound(reply)
      expect(v.matched.map(m => m.ruleId)).toEqual([])
      expect(v.outcome).toBe('allow')
    })
  }

  it('does not fire on prose that merely mentions an error in customer terms', () => {
    const v = evaluateOutbound('如果您登入時遇到錯誤,請先清除瀏覽器快取再試一次。')
    expect(v.outcome).toBe('allow')
  })

  it('treats empty and whitespace-only text as allow, not as a hit', () => {
    expect(evaluateOutbound('').outcome).toBe('allow')
    expect(evaluateOutbound('   \n  ').outcome).toBe('allow')
  })
})

describe('evaluateOutbound — known leaks are caught', () => {
  it('strips a model fallback banner and keeps the real answer', () => {
    const v = evaluateOutbound('⚠️ Model Fallback: kimi-code unavailable\n您好,營業時間是 09:00–17:00。')
    expect(v.outcome).toBe('rewrite')
    expect(v.matched.map(m => m.ruleId)).toContain('model-fallback')
    expect(v.proposedText).toBe('您好,營業時間是 09:00–17:00。')
  })

  it('strips a reasoning tag leak', () => {
    const v = evaluateOutbound('<thinking>使用者在問價格,我先查 wiki</thinking>單人辦公室每月 8,000 元。')
    expect(v.outcome).toBe('rewrite')
    expect(v.proposedText).toBe('單人辦公室每月 8,000 元。')
  })

  it('handles an unterminated reasoning tag (stream cut mid-thought)', () => {
    const v = evaluateOutbound('好的<think>等等,先確認一下這個房型還有沒有空')
    expect(v.matched.map(m => m.ruleId)).toContain('reasoning-tag')
    expect(v.proposedText).toBe('好的')
  })

  it('blocks a stack trace outright', () => {
    const v = evaluateOutbound('TypeError: cannot read property foo of undefined\n    at handler (/app/x.js:12:9)')
    expect(v.outcome).toBe('block')
    expect(v.proposedText).toBeNull()
  })

  it('blocks a shell/tool error', () => {
    const v = evaluateOutbound('抱歉,查詢失敗:ENOENT: no such file or directory')
    expect(v.outcome).toBe('block')
    expect(v.matched.map(m => m.ruleId)).toContain('tool-error')
  })

  it('blocks a provider error', () => {
    const v = evaluateOutbound('Request failed: rate_limit_error, please retry')
    expect(v.outcome).toBe('block')
  })

  it('blocks a reply containing an internal filesystem path', () => {
    // Stripping used to leave the surrounding machine output behind — e.g.
    // "find files in  -> show first 50 lines failed" — which reads worse to a
    // customer than the original. Text like this is machine output throughout.
    const v = evaluateOutbound('資料存在 /home/openclaw/.openclaw/workspaces/farfaraway-cs/wiki 裡面')
    expect(v.outcome).toBe('block')
    expect(v.proposedText).toBeNull()
  })

  it('strips unrendered media placeholders', () => {
    const v = evaluateOutbound('這是您要的平面圖 <media:image> 請參考')
    expect(v.outcome).toBe('rewrite')
    expect(v.proposedText).not.toContain('<media:')
  })

  it('blocks when stripping would leave nothing to send', () => {
    const v = evaluateOutbound('<media:image>')
    expect(v.outcome).toBe('block')
    expect(v.proposedText).toBeNull()
  })

  it('blocks the LLM request failure that reached a customer on 2026-08-29', () => {
    const v = evaluateOutbound('LLM request failed: provider rejected the request schema or tool payload.')
    expect(v.outcome).toBe('block')
    expect(v.matched.map(m => m.ruleId)).toContain('llm-request-failed')
  })

  it('blocks the bare LLM failure variant', () => {
    expect(evaluateOutbound('LLM request failed.').outcome).toBe('block')
  })

  it('blocks the model narrating its own missing tools', () => {
    const v = evaluateOutbound('I can\'t use the tool "exec" here because it isn\'t available. I need to stop retrying it and answer without that tool.')
    expect(v.outcome).toBe('block')
    expect(v.matched.map(m => m.ruleId)).toContain('model-meta')
  })

  it('blocks the "Based on the tools available to me" preamble', () => {
    const v = evaluateOutbound('Based on the tools available to me, I attempted to read the wiki directory, but the `read` tool returned `EISDIR`.')
    expect(v.outcome).toBe('block')
    expect(v.matched.map(m => m.ruleId)).toContain('model-meta')
  })

  it("blocks openclaw's tool-failure banner even with no path in it", () => {
    const v = evaluateOutbound('⚠️ 🛠️ find files in the wiki -> show first 50 lines failed')
    expect(v.outcome).toBe('block')
  })

  it('a block rule wins over a strip rule in the same reply', () => {
    const v = evaluateOutbound('Model Fallback: kimi-code unavailable\nENOENT: no such file or directory')
    expect(v.outcome).toBe('block')
    expect(v.matched.length).toBeGreaterThan(1)
  })
})

describe('evaluateOutbound — mechanics', () => {
  it('is stateless across calls despite global regexes', () => {
    const text = '<media:image> 平面圖如附'
    const first = evaluateOutbound(text)
    const second = evaluateOutbound(text)
    expect(second).toEqual(first)
  })

  it('does not mutate the caller rule array or its regexes', () => {
    const before = DEFAULT_RULES.map(r => r.pattern.lastIndex)
    evaluateOutbound('<media:image> x <media:video>')
    expect(DEFAULT_RULES.map(r => r.pattern.lastIndex)).toEqual(before)
  })

  it('truncates the recorded sample so one huge reply cannot bloat the log', () => {
    const rule: FilterRule = { id: 'x', label: 'x', action: 'strip', pattern: /A+/g }
    const v = evaluateOutbound('A'.repeat(5000) + ' 您好', [rule])
    expect(v.matched[0].sample.length).toBe(200)
  })

  it('collapses the blank lines that stripping leaves behind', () => {
    const v = evaluateOutbound('Model Fallback: down\n\n\n\n您好,請問需要什麼協助?')
    expect(v.proposedText).toBe('您好,請問需要什麼協助?')
  })
})
