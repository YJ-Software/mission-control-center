import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { deriveInternalToken } from '@/lib/internal-token'

// proxy.ts verifies the session cookie with process.env.AUTH_SECRET at call
// time, so signing here with the same secret matches — without coupling to
// auth.ts, which captures its secret at module load.
function signSession(secret: string): string {
  const payload = `${Date.now()}.abcdef`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

// Regression guard for the proxy.ts auth bypass. The exemption for local cron
// used to key off `Host` + `X-Forwarded-For`, both of which the client sets, so
// a remote request could forge `Host: localhost` + `X-Forwarded-For: 127.0.0.1`
// and reach every /api route unauthenticated. These pin the fix: forged headers
// no longer help, and the internal token is what actually opens the cron path.

const SECRET = 'test-auth-secret'
const PASSWORD = 'test-password'

function req(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://mcc.local${path}`, { headers })
}

/** 200/next (allowed) vs 401/redirect (blocked). */
function allowed(res: ReturnType<typeof proxy>): boolean {
  // NextResponse.next() has no location and no error body; a block is either a
  // 401 JSON or a 307 redirect to /login.
  if (res.status === 401) return false
  if (res.headers.get('location')) return false
  return true
}

describe('proxy auth', () => {
  beforeEach(() => {
    process.env.AUTH_PASSWORD = PASSWORD
    process.env.AUTH_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.AUTH_PASSWORD
    delete process.env.AUTH_SECRET
  })

  it('blocks the forged Host + X-Forwarded-For bypass on /api', () => {
    const res = proxy(
      req('/api/action', { host: 'localhost', 'x-forwarded-for': '127.0.0.1' }),
    )
    expect(allowed(res)).toBe(false)
    expect(res.status).toBe(401)
  })

  it('also blocks forged Host with ::1', () => {
    expect(
      allowed(proxy(req('/api/upgrade/system-check', { host: '127.0.0.1', 'x-forwarded-for': '::1' }))),
    ).toBe(false)
  })

  it('blocks an unauthenticated API request outright', () => {
    expect(allowed(proxy(req('/api/action')))).toBe(false)
  })

  it('allows a request carrying a valid session cookie', () => {
    const token = signSession(SECRET)
    expect(allowed(proxy(req('/api/action', { cookie: `mc_session=${token}` })))).toBe(true)
  })

  it('allows the internal cron path with a valid internal token', () => {
    const t = deriveInternalToken(SECRET)
    expect(allowed(proxy(req('/api/morning-report?action=fetch-feeds', { 'x-internal-token': t })))).toBe(
      true,
    )
  })

  it('rejects a forged/absent internal token', () => {
    expect(allowed(proxy(req('/api/morning-report', { 'x-internal-token': 'forged' })))).toBe(false)
    expect(allowed(proxy(req('/api/morning-report', { 'x-internal-token': deriveInternalToken('other') })))).toBe(
      false,
    )
  })

  it('still lets public paths and health through', () => {
    expect(allowed(proxy(req('/api/health')))).toBe(true)
    expect(allowed(proxy(req('/login')))).toBe(true)
    expect(allowed(proxy(req('/api/auth', { host: 'anything' })))).toBe(true)
  })

  it('leaves the backup token path (header presence) working', () => {
    expect(allowed(proxy(req('/api/backup/run', { 'x-backup-token': 'anything' })))).toBe(true)
  })

  it('opens everything when AUTH_PASSWORD is unset (auth disabled)', () => {
    delete process.env.AUTH_PASSWORD
    expect(allowed(proxy(req('/api/action')))).toBe(true)
  })
})
