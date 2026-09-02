import { describe, expect, it } from 'vitest'
import { injectCronAuth } from '@/lib/morning-report/cron-auth'

// The cron commands curl the local API. proxy.ts no longer trusts Host/XFF, so
// the curls must carry X-Internal-Token. This is injected at substitution time
// so BOTH the bundled templates AND any customer-customized template get it —
// without a placeholder the user could omit.
const TOK = 'deadbeef'
const BASE = 'http://localhost:3737'

describe('injectCronAuth', () => {
  it('substitutes ${BASE_URL} and adds the token header to that curl', () => {
    const out = injectCronAuth("curl -s -X POST '${BASE_URL}/api/morning-report?action=finalize'", BASE, TOK)
    expect(out).toContain(BASE + '/api/morning-report?action=finalize')
    expect(out).toMatch(/curl -H "X-Internal-Token: deadbeef" -s -X POST/)
    expect(out).not.toContain('${BASE_URL}')
  })

  it('handles the -fsS flag form', () => {
    const out = injectCronAuth("curl -fsS '${BASE_URL}/api/x'", BASE, TOK)
    expect(out).toMatch(/curl -H "X-Internal-Token: deadbeef" -fsS/)
  })

  it('injects on a customized template that never mentioned a token', () => {
    const custom = "先執行：\ncurl -s -X POST '${BASE_URL}/api/morning-report?action=fetch-feeds'\n回報結果。"
    const out = injectCronAuth(custom, BASE, TOK)
    expect(out).toContain('X-Internal-Token: deadbeef')
    expect(out).toContain('先執行')
  })

  it('does not touch a curl that is not aimed at BASE_URL', () => {
    const out = injectCronAuth("curl -s 'https://example.com/x'", BASE, TOK)
    expect(out).not.toContain('X-Internal-Token')
  })

  it('is idempotent — does not double-inject', () => {
    const once = injectCronAuth("curl -s '${BASE_URL}/api/x'", BASE, TOK)
    const twice = injectCronAuth(once, BASE, TOK)
    expect((twice.match(/X-Internal-Token/g) || []).length).toBe(1)
  })

  it('adds nothing when the token is empty (auth disabled)', () => {
    const out = injectCronAuth("curl -s '${BASE_URL}/api/x'", BASE, '')
    expect(out).not.toContain('X-Internal-Token')
    expect(out).toContain(BASE + '/api/x')
  })
})
