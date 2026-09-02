import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { verifyInternalToken, INTERNAL_TOKEN_HEADER } from '@/lib/internal-token'

const SESSION_COOKIE = 'mc_session'

// Paths that don't require session auth (may have their own auth mechanism)
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/health']

// Paths that use alternative auth (e.g. X-Backup-Token header)
const TOKEN_AUTH_PATHS = ['/api/backup/run', '/api/backup/restore']

function verifyToken(token: string, secret: string): boolean {
  if (!token) return false
  const lastDot = token.lastIndexOf('.')
  if (lastDot === -1) return false
  const payload = token.substring(0, lastDot)
  const sig = token.substring(lastDot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    const sigBuf = Buffer.from(sig, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(sigBuf, expectedBuf)
  } catch {
    return false
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths, static assets, Next.js internals
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Check AUTH_PASSWORD env — if not set, auth is disabled
  const authPassword = process.env.AUTH_PASSWORD
  if (!authPassword) {
    return NextResponse.next()
  }

  // Allow paths with alternative auth (they verify tokens internally)
  if (TOKEN_AUTH_PATHS.some(p => pathname.startsWith(p)) && req.headers.get('x-backup-token')) {
    return NextResponse.next()
  }

  // Allow internal API calls (cron jobs curl the API from the local machine).
  // This used to trust `Host: localhost` + a loopback `X-Forwarded-For`, but
  // both are client-set: a remote request could forge them and reach every
  // /api route — including the privileged /api/action — with no session
  // (verified exploitable 2026-09-02). The cron curls now carry a token derived
  // from AUTH_SECRET, which an outsider cannot compute.
  if (pathname.startsWith('/api/')) {
    if (verifyInternalToken(req.headers.get(INTERNAL_TOKEN_HEADER), process.env.AUTH_SECRET || '')) {
      return NextResponse.next()
    }
  }

  // Verify session token
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const secret = process.env.AUTH_SECRET || ''

  if (!token || !secret || !verifyToken(token, secret)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.svg).*)'],
}
