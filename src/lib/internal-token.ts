import { createHmac, timingSafeEqual } from 'crypto'

// A token the in-process cron curls carry so proxy.ts can tell a genuine
// internal call from a forged one. It replaces the old exemption that trusted
// `Host` + `X-Forwarded-For` — both client-set, so a remote request could forge
// `Host: localhost` + `X-Forwarded-For: 127.0.0.1` and reach every /api route
// with no session (verified exploitable 2026-09-02).
//
// Derived from AUTH_SECRET, which install.sh already seeds alongside
// AUTH_PASSWORD, so nothing new has to be provisioned and the value is stable
// across restarts (baked cron commands keep working). It is an HMAC, so the
// secret itself is never exposed in a cron command or process listing.

const LABEL = 'mcc-internal-api'

export function deriveInternalToken(secret: string): string {
  return createHmac('sha256', secret).update(LABEL).digest('hex')
}

/** True only for the exact derived token under a non-empty secret. An empty
 * secret can derive nothing worth trusting, so it grants nothing. */
export function verifyInternalToken(headerValue: string | null | undefined, secret: string): boolean {
  if (!secret || !headerValue) return false
  const expected = deriveInternalToken(secret)
  try {
    const a = Buffer.from(headerValue, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** The header the cron curls set, and proxy.ts checks. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token'
