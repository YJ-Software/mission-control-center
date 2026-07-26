import { describe, it, expect, vi } from 'vitest'

// Resolve names deterministically instead of touching real DNS.
const lookup = vi.fn()
vi.mock('dns/promises', () => ({ lookup: (...a: unknown[]) => lookup(...a) }))

import { assertPublicUrl, UnsafeUrlError } from '@/lib/morning-report/safe-fetch'

/**
 * A pasted feed address is an operator-supplied target for a server-side
 * request, and the stored one is re-fetched unattended every couple of hours.
 * Without this guard that reaches cloud metadata (169.254.169.254), the
 * OpenClaw gateway on loopback, and anything else on the private network.
 */

const publicAddr = () => lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

async function refuses(url: string) {
  await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError)
}

describe('assertPublicUrl — literal addresses', () => {
  it('refuses loopback', async () => {
    await refuses('http://127.0.0.1:3737/api/health')
    await refuses('http://[::1]:18789/')
  })

  it('refuses cloud metadata', async () => {
    // The one that turns a feed URL into cloud credentials on a VPS.
    await refuses('http://169.254.169.254/latest/meta-data/iam/security-credentials/')
  })

  it('refuses RFC1918 space', async () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
      await refuses(`http://${ip}/feed.xml`)
    }
  })

  it('refuses CGNAT, where this tailnet lives', async () => {
    await refuses('http://100.72.74.90:3737/api/morning-report')
  })

  it('refuses IPv6 unique-local and link-local', async () => {
    await refuses('http://[fc00::1]/')
    await refuses('http://[fe80::1]/')
  })

  it('refuses IPv4-mapped IPv6 smuggling a private address', async () => {
    await refuses('http://[::ffff:127.0.0.1]/')
    await refuses('http://[::ffff:169.254.169.254]/')
  })

  it('allows a public literal address', async () => {
    await expect(assertPublicUrl('https://93.184.216.34/feed.xml')).resolves.toBeInstanceOf(URL)
  })
})

describe('assertPublicUrl — names', () => {
  it('allows a name that resolves publicly', async () => {
    publicAddr()
    await expect(assertPublicUrl('https://example.com/feed.xml')).resolves.toBeInstanceOf(URL)
  })

  it('refuses a name that resolves to loopback', async () => {
    // The DNS-based version of the same attack.
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await refuses('https://evil.example.com/feed.xml')
  })

  it('refuses when any answer is private, not just the first', async () => {
    // A host answering with both is exactly the shape of an attack.
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ])
    await refuses('https://mixed.example.com/feed.xml')
  })

  it('refuses a name that does not resolve at all', async () => {
    lookup.mockResolvedValue([])
    await refuses('https://nowhere.example.com/feed.xml')
  })

  it('refuses when resolution fails', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await refuses('https://broken.example.com/feed.xml')
  })
})

describe('assertPublicUrl — schemes and junk', () => {
  it('refuses non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://example.com/f']) {
      await refuses(url)
    }
  })

  it('refuses malformed input', async () => {
    await refuses('not a url')
    await refuses('')
  })

  it('does not report which internal host answered', async () => {
    // The message tells the operator what was refused without turning the
    // error into a scanning oracle.
    await assertPublicUrl('http://10.0.0.5/x').catch((e: Error) => {
      expect(e.message).not.toContain('10.0.0.5')
    })
  })
})
