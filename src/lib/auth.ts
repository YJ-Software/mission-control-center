import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ''
const AUTH_SECRET = process.env.AUTH_SECRET || randomBytes(32).toString('hex')
const SESSION_COOKIE = 'mc_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function isAuthEnabled(): boolean {
  return AUTH_PASSWORD.length > 0
}

export function verifyPassword(input: string): boolean {
  if (!AUTH_PASSWORD) return true
  if (!input) return false
  const a = Buffer.from(input)
  const b = Buffer.from(AUTH_PASSWORD)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function createSessionToken(): string {
  const payload = `${Date.now()}.${randomBytes(16).toString('hex')}`
  const sig = createHmac('sha256', AUTH_SECRET).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifySessionToken(token: string): boolean {
  if (!token) return false
  const lastDot = token.lastIndexOf('.')
  if (lastDot === -1) return false
  const payload = token.substring(0, lastDot)
  const sig = token.substring(lastDot + 1)
  const expected = createHmac('sha256', AUTH_SECRET).update(payload).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function validateRequest(req: NextRequest): boolean {
  if (!isAuthEnabled()) return true
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return token ? verifySessionToken(token) : false
}

export async function validateSession(): Promise<boolean> {
  if (!isAuthEnabled()) return true
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  return token ? verifySessionToken(token) : false
}

export { SESSION_COOKIE, SESSION_MAX_AGE }

/**
 * Extract the client IP from a NextRequest, preferring proxy headers when
 * the upstream is trusted (TRUST_PROXY=1). Falls back to the direct peer
 * address reported by the runtime.
 *
 * Used by login / auth logging so fail2ban (or any SIEM) can match attempts
 * to a real attacker IP rather than the proxy's loopback.
 */
export function getClientIp(req: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === '1'
  const hdr = req.headers
  if (trustProxy) {
    // x-forwarded-for is a comma-separated chain; the left-most is the
    // original client per RFC 7239.
    const xff = hdr.get('x-forwarded-for')
    if (xff) {
      const first = xff.split(',')[0]?.trim()
      if (first) return first
    }
    const real = hdr.get('x-real-ip')
    if (real) return real.trim()
  }
  // Next.js 16 exposes the peer on x-forwarded-for by default when coming
  // through its own runtime; this is the safe fallback regardless of trust.
  const fallback = hdr.get('x-forwarded-for')?.split(',')[0]?.trim()
  return fallback || 'unknown'
}
