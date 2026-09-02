import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectCronAuth } from '@/lib/morning-report/cron-auth'

// Belt-and-braces over the unit tests: run injectCronAuth on the ACTUAL bundled
// templates that curl the local API. If a template's curl line drifts (flag
// change, reordered args) so the header no longer lands, this catches it — the
// production cron would otherwise 401 silently after the proxy.ts fix.
const DIR = join(process.cwd(), 'data', 'morning-report', 'default-templates')
const API_TEMPLATES = ['_finalize-message.md', '_podcast-message.md', '_podcast-harvest-message.md']

describe('bundled cron templates carry the token after injection', () => {
  for (const name of API_TEMPLATES) {
    it(`${name} gets X-Internal-Token on its API curl`, () => {
      const p = join(DIR, name)
      if (!existsSync(p)) return // release layout differs; unit tests cover the logic
      const raw = readFileSync(p, 'utf8')
      expect(raw).toMatch(/\$\{BASE_URL\}\/api\//) // precondition: it curls the API
      const out = injectCronAuth(raw, 'http://localhost:3737', 'tok123')
      expect(out).toContain('X-Internal-Token: tok123')
      expect(out).not.toContain('${BASE_URL}')
    })
  }

  it('a curl to an external host in a template would NOT get the token', () => {
    const out = injectCronAuth("curl -s 'https://api.example.com/x'", 'http://localhost:3737', 'tok123')
    expect(out).not.toContain('X-Internal-Token')
  })
})
