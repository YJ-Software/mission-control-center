import { describe, expect, it } from 'vitest'
import { rewriteDynamicBlock } from '../../scripts/e2e/twnoc/lib/env-writer.mjs'

describe('rewriteDynamicBlock', () => {
  const baseFile = `
KEEP=untouched
# >>> e2e dynamic
AUTH_PASSWORD=oldvalue
# <<<
TRAILING=keepme
`.trimStart()

  it('replaces values inside the dynamic block', () => {
    const out = rewriteDynamicBlock(baseFile, { AUTH_PASSWORD: 'newvalue' })
    expect(out).toContain('AUTH_PASSWORD=newvalue')
    expect(out).not.toContain('AUTH_PASSWORD=oldvalue')
    expect(out).toContain('KEEP=untouched')
    expect(out).toContain('TRAILING=keepme')
  })

  it('appends a dynamic block when missing', () => {
    const file = 'KEEP=x\n'
    const out = rewriteDynamicBlock(file, { AUTH_PASSWORD: 'v' })
    expect(out).toMatch(/# >>> e2e dynamic\nAUTH_PASSWORD=v\n# <<</)
    expect(out).toContain('KEEP=x')
  })

  it('adds keys not already inside the block', () => {
    const out = rewriteDynamicBlock(baseFile, { AUTH_PASSWORD: 'v', NEW_KEY: 'n' })
    expect(out).toContain('AUTH_PASSWORD=v')
    expect(out).toContain('NEW_KEY=n')
  })
})
