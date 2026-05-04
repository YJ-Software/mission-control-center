import { describe, it, expect } from 'vitest'
import { parseAgentsUrlState, buildAgentsUrl } from '../../src/app/(dashboard)/agents/_components/url-state'

describe('agents url state', () => {
  it('parses defaults when params missing', () => {
    expect(parseAgentsUrlState(new URLSearchParams())).toEqual({ agent: null, tab: 'overview' })
  })

  it('parses valid params', () => {
    const p = new URLSearchParams({ agent: 'main', tab: 'skills' })
    expect(parseAgentsUrlState(p)).toEqual({ agent: 'main', tab: 'skills' })
  })

  it('rejects unknown tab and falls back to overview', () => {
    const p = new URLSearchParams({ tab: 'bogus' })
    expect(parseAgentsUrlState(p).tab).toBe('overview')
  })

  it('builds URL with selected tab + agent', () => {
    expect(buildAgentsUrl({ agent: 'mini', tab: 'tools' })).toBe('/agents?agent=mini&tab=tools')
    expect(buildAgentsUrl({ agent: null, tab: 'overview' })).toBe('/agents')
  })
})
