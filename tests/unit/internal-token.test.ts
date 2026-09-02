import { describe, expect, it } from 'vitest'
import { deriveInternalToken, verifyInternalToken } from '@/lib/internal-token'

// The localhost-cron exemption in proxy.ts used to trust `Host` + `X-Forwarded-For`,
// both attacker-controlled — a remote request with `Host: localhost` and
// `X-Forwarded-For: 127.0.0.1` reached the privileged /api/action handler with
// no session (verified exploitable 2026-09-02). The replacement is a token the
// internal cron curls carry and outsiders cannot forge. It is derived from the
// already-present AUTH_SECRET so nothing new has to be seeded at install time.

describe('deriveInternalToken', () => {
  it('is deterministic for a given secret', () => {
    expect(deriveInternalToken('s3cret')).toBe(deriveInternalToken('s3cret'))
  })

  it('differs when the secret differs', () => {
    expect(deriveInternalToken('a')).not.toBe(deriveInternalToken('b'))
  })

  it('is not the secret itself', () => {
    expect(deriveInternalToken('s3cret')).not.toContain('s3cret')
  })
})

describe('verifyInternalToken', () => {
  const secret = 'the-auth-secret'
  const good = deriveInternalToken(secret)

  it('accepts the derived token', () => {
    expect(verifyInternalToken(good, secret)).toBe(true)
  })

  it('rejects a wrong token', () => {
    expect(verifyInternalToken('nope', secret)).toBe(false)
    expect(verifyInternalToken(deriveInternalToken('other'), secret)).toBe(false)
  })

  it('rejects a missing token', () => {
    expect(verifyInternalToken(null, secret)).toBe(false)
    expect(verifyInternalToken('', secret)).toBe(false)
  })

  // No secret means no derivable token — must never grant access, or a
  // misconfigured box would accept an empty/derived-from-empty token.
  it('rejects everything when the secret is empty', () => {
    expect(verifyInternalToken(deriveInternalToken(''), '')).toBe(false)
    expect(verifyInternalToken('anything', '')).toBe(false)
  })

  it('is length-safe against garbage input', () => {
    expect(verifyInternalToken('x', secret)).toBe(false)
    expect(verifyInternalToken(good + 'tail', secret)).toBe(false)
  })
})
