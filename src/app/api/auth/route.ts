import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword, createSessionToken, validateRequest,
  isAuthEnabled, getClientIp, SESSION_COOKIE, SESSION_MAX_AGE
} from '@/lib/auth'

// GET /api/auth — check auth status
export async function GET(req: NextRequest) {
  return NextResponse.json({
    authenticated: !isAuthEnabled() || validateRequest(req),
    authEnabled: isAuthEnabled(),
  })
}

// POST /api/auth — login
export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const ip = getClientIp(req)

  if (!verifyPassword(password)) {
    // Stable prefix + IP in a fixed position — see deploy/fail2ban/filter.d
    // for the matching regex. Don't reshape this line without updating the
    // filter at the same time, or bans will stop working.
    console.warn(`[mc-auth] failed login from ${ip}`)
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 })
  }

  console.log(`[mc-auth] login ok from ${ip}`)
  const token = createSessionToken()
  const res = NextResponse.json({ ok: true })

  // Detect whether this request came in over HTTPS. In production behind a
  // Cloudflare tunnel / reverse proxy, the cookie must be Secure so the
  // browser sends it back; for direct-HTTP LAN access, Secure would drop
  // the cookie and the user bounces back to /login after a successful POST.
  // We trust x-forwarded-proto for the Secure decision — forging it only
  // hurts the forger (their login would stop working).
  const xfp = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = xfp || new URL(req.url).protocol.replace(':', '')
  const isHttps = proto === 'https'

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: isHttps,
  })
  return res
}

// DELETE /api/auth — logout
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
