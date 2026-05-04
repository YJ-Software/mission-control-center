import { describe, it, expect } from 'vitest'
import { renderTemplate } from '@/lib/second-brain/skills/render'

describe('renderTemplate', () => {
  it('substitutes {{var}} placeholders', () => {
    const out = renderTemplate('Hello {{name}}!', { name: 'Moni' })
    expect(out).toBe('Hello Moni!')
  })

  it('replaces all occurrences', () => {
    const out = renderTemplate('{{a}} and {{a}} and {{b}}', { a: 'x', b: 'y' })
    expect(out).toBe('x and x and y')
  })

  it('coerces booleans to "true"/"false"', () => {
    const out = renderTemplate('enabled={{on}}', { on: true })
    expect(out).toBe('enabled=true')
  })

  it('throws on unknown placeholder', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow(/unknown placeholder: missing/)
  })

  it('leaves escaped placeholders alone', () => {
    const out = renderTemplate('literal \\{{var}} vs {{var}}', { var: 'X' })
    expect(out).toBe('literal {{var}} vs X')
  })
})
