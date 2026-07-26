import { lookup } from 'dns/promises'
import { isIP } from 'net'

/**
 * Fetch a URL supplied by the operator without letting it reach the inside of
 * the network.
 *
 * News feeds are public internet resources, so refusing private space costs no
 * legitimate functionality — but allowing it turns "paste a feed address" into
 * a server-side request primitive. The dashboard runs on VPS hosts where
 * 169.254.169.254 hands out cloud credentials, alongside the OpenClaw gateway
 * on loopback, and a stored feed is re-fetched unattended every couple of
 * hours, so the reach would be durable rather than one-shot.
 *
 * Known limit: the address is checked, then `fetch` resolves it again, leaving
 * a DNS-rebinding window. Closing that needs connect-time IP pinning, which is
 * not worth the machinery here; this stops the whole class of pasted-address
 * attacks, not a determined attacker who also controls a DNS zone.
 */

const MAX_REDIRECTS = 3

/** Ranges that must never be reachable from a pasted address. */
function isBlockedIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true
  const [a, b] = p
  return (
    a === 0 ||                          // "this network"
    a === 10 ||                         // RFC1918
    a === 127 ||                        // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT / Tailscale
    (a === 169 && b === 254) ||         // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) ||         // RFC1918
    (a === 192 && b === 0) ||           // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                            // multicast and reserved
  )
}

/**
 * Expand a valid IPv6 address to its eight 16-bit groups.
 *
 * Textual comparison isn't enough: `new URL()` rewrites `::ffff:127.0.0.1`
 * into `::ffff:7f00:1`, so a prefix match on the dotted form lets loopback
 * straight through. Working on the numbers avoids depending on which spelling
 * survived parsing.
 */
function expandIPv6(ip: string): number[] | null {
  let v = ip.toLowerCase().split('%')[0]

  // A trailing dotted quad (mapped/compatible form) becomes two hex groups.
  const dotted = v.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const o = dotted[1].split('.').map(Number)
    if (o.some((n) => Number.isNaN(n) || n > 255)) return null
    v = v.slice(0, -dotted[1].length) +
      ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }

  const [head, tail] = v.split('::')
  const parse = (s: string) => (s ? s.split(':').filter(Boolean).map((g) => parseInt(g, 16)) : [])
  const left = parse(head)
  const right = tail === undefined ? [] : parse(tail)
  if (tail === undefined) return left.length === 8 ? left : null

  const gap = 8 - left.length - right.length
  if (gap < 0) return null
  return [...left, ...Array(gap).fill(0), ...right]
}

function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip)
  if (!g) return true

  const allZero = (n: number) => g.slice(0, n).every((x) => x === 0)

  if (allZero(7) && (g[7] === 0 || g[7] === 1)) return true      // :: and ::1
  // ::ffff:0:0/96 mapped and ::/96 compatible both carry an IPv4 address.
  if (allZero(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.')
    return isBlockedIPv4(v4)
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true                    // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true                    // fe80::/10 link-local
  return false
}

function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true
}

export class UnsafeUrlError extends Error {}

/**
 * Reject anything that isn't a public http(s) address.
 *
 * Throws UnsafeUrlError with a message safe to show the operator — it names
 * what was refused without reporting which internal hosts answered.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new UnsafeUrlError('網址格式無效')
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new UnsafeUrlError('只接受 http 或 https 網址')
  }

  // A literal address skips DNS entirely.
  const literal = isIP(u.hostname) ? u.hostname : u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (isBlockedAddress(literal)) throw new UnsafeUrlError('不允許指向內部網路位址')
    return u
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(u.hostname, { all: true })
  } catch {
    throw new UnsafeUrlError('無法解析此網域')
  }

  // Any private answer disqualifies the name — a host that resolves to both
  // public and internal addresses is exactly the shape of an attack.
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new UnsafeUrlError('不允許指向內部網路位址')
  }

  return u
}

/**
 * Fetch a feed, validating the address and every redirect hop.
 *
 * Redirects are followed by hand because the automatic follower would chase a
 * `Location: http://169.254.169.254/…` without asking.
 */
export async function safeFetchFeed(raw: string, timeoutMs: number): Promise<Response> {
  let target = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(target)
    const res = await fetch(url, {
      headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new UnsafeUrlError(`來源回應 ${res.status} 但未提供轉址目標`)
      target = new URL(location, url).toString()
      continue
    }
    return res
  }
  throw new UnsafeUrlError('轉址次數過多')
}
