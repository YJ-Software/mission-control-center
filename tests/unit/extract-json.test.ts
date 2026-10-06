import { describe, it, expect } from 'vitest'
import { extractJson } from '@/lib/openclaw/models-config'

describe('extractJson', () => {
  it('parses clean object and array input unchanged', () => {
    expect(extractJson('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] })
    expect(extractJson('[1,{"x":"}"}]')).toEqual([1, { x: '}' }])
  })
  it('skips non-JSON noise before the value', () => {
    expect(extractJson('doctor warnings\n{"ok":true}\n')).toEqual({ ok: true })
  })
  it('skips a bracketed log prefix like "[plugins] foo"', () => {
    expect(extractJson('[plugins] foo\n{"ok":true,"n":[1]}')).toEqual({ ok: true, n: [1] })
    expect(extractJson('[warn] x [y]\n{"a":1}')).toEqual({ a: 1 })
  })
  it('still throws when there is no JSON, or only unbalanced JSON', () => {
    expect(() => extractJson('nothing here')).toThrow(/no JSON value/)
    expect(() => extractJson('{"a":')).toThrow(/unbalanced/)
  })
})
