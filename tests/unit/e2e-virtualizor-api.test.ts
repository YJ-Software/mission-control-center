import { describe, expect, it } from 'vitest'
import { buildEnduserUrl } from '../../scripts/e2e/twnoc/lib/virtualizor-api.mjs'

describe('buildEnduserUrl', () => {
  it('puts auth + action in querystring', () => {
    const url = buildEnduserUrl({
      panel: 'https://vps.twnoc.net',
      apiKey: 'KEY1',
      apiPass: 'PASS1',
      act: 'rebuild',
      params: { vpsid: 1234, osid: 9 },
    })
    expect(url).toContain('act=rebuild')
    expect(url).toContain('api=json')
    expect(url).toContain('apikey=KEY1')
    expect(url).toContain('apipass=PASS1')
    expect(url).toContain('vpsid=1234')
    expect(url).toContain('osid=9')
  })

  it('keeps panel base path', () => {
    const url = buildEnduserUrl({
      panel: 'https://vps.example.com',
      apiKey: 'k',
      apiPass: 'p',
      act: 'vpsmanage',
      params: {},
    })
    expect(url.startsWith('https://vps.example.com/index.php?')).toBe(true)
  })
})
