import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveSecretRef, isSecretRef } from '@/lib/openclaw/secret-ref'

// OpenClaw lets an operator move plaintext secrets out of openclaw.json into a
// secret store, leaving a structured ref behind:
//
//   "token": { "source": "store", "provider": "default", "id": "GATEWAY_TOKEN" }
//
// MCC read those fields as raw strings (`config?.gateway?.auth?.token || ''`).
// An object is truthy, so the `|| ''` fallback never fired and MCC sent the
// object itself as the gateway token — the dashboard lost its gateway
// connection with no error pointing at the cause.

describe('isSecretRef', () => {
  it('recognises a structured ref', () => {
    expect(isSecretRef({ source: 'store', provider: 'default', id: 'X' })).toBe(true)
  })

  it('does not mistake a plain token string for a ref', () => {
    expect(isSecretRef('sk-plain-token')).toBe(false)
  })

  it('rejects objects that are not refs', () => {
    expect(isSecretRef({ nope: 1 })).toBe(false)
    expect(isSecretRef(null)).toBe(false)
    expect(isSecretRef(undefined)).toBe(false)
  })
})

describe('resolveSecretRef', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'secretref-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes a plain string through unchanged', () => {
    expect(resolveSecretRef('sk-plain-token').value).toBe('sk-plain-token')
  })

  it('returns null for empty/absent values', () => {
    expect(resolveSecretRef(undefined).value).toBeNull()
    expect(resolveSecretRef('').value).toBeNull()
  })

  it('resolves an env ref from the environment', () => {
    const r = resolveSecretRef(
      { source: 'env', provider: 'default', id: 'MCC_TEST_SECRET' },
      { env: { MCC_TEST_SECRET: 'from-env' } },
    )
    expect(r.value).toBe('from-env')
  })

  it('reports an env ref whose variable is not set', () => {
    const r = resolveSecretRef({ source: 'env', provider: 'default', id: 'MISSING' }, { env: {} })
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/MISSING/)
  })

  // A file ref does NOT carry a path. The path lives on the provider entry in
  // secrets.providers, and `id` is an identifier within it: the literal
  // "value" in singleValue mode, or an absolute JSON pointer otherwise (json
  // is the default mode). Treating `id` as a path silently resolves nothing.
  it('resolves a singleValue file provider and trims the trailing newline', () => {
    const p = join(dir, 'tok')
    writeFileSync(p, 'file-token\n')
    const r = resolveSecretRef(
      { source: 'file', provider: 'local-file', id: 'value' },
      { secrets: { providers: { 'local-file': { source: 'file', path: p, mode: 'singleValue' } } } },
    )
    expect(r.value).toBe('file-token')
  })

  it('resolves a json file provider through the JSON pointer', () => {
    const p = join(dir, 'secrets.json')
    writeFileSync(p, JSON.stringify({ gateway: { token: 'ptr-token' } }))
    const r = resolveSecretRef(
      { source: 'file', provider: 'bundle', id: '/gateway/token' },
      { secrets: { providers: { bundle: { source: 'file', path: p } } } },
    )
    expect(r.value).toBe('ptr-token')
  })

  it('reports a file ref whose provider is not configured', () => {
    const r = resolveSecretRef({ source: 'file', provider: 'missing', id: 'value' }, { secrets: {} })
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/missing/)
  })

  it('reports a file ref whose file is missing instead of throwing', () => {
    const r = resolveSecretRef(
      { source: 'file', provider: 'local-file', id: 'value' },
      {
        secrets: {
          providers: { 'local-file': { source: 'file', path: join(dir, 'nope'), mode: 'singleValue' } },
        },
      },
    )
    expect(r.value).toBeNull()
    expect(r.reason).toBeTruthy()
  })

  it('reports a JSON pointer that does not resolve', () => {
    const p = join(dir, 'partial.json')
    writeFileSync(p, JSON.stringify({ gateway: {} }))
    const r = resolveSecretRef(
      { source: 'file', provider: 'bundle', id: '/gateway/token' },
      { secrets: { providers: { bundle: { source: 'file', path: p } } } },
    )
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/\/gateway\/token/)
  })

  // The whole point of the store is that secret-kind entries cannot be read
  // back — `openclaw secrets store get` answers "write-only by design". So MCC
  // cannot resolve one, and must say so in a way that names the fix rather than
  // failing silently.
  it('cannot resolve a store ref, and says what to do instead', () => {
    const r = resolveSecretRef({ source: 'store', provider: 'default', id: 'GATEWAY_TOKEN' })
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/write-only/i)
    expect(r.reason).toMatch(/OPENCLAW_TOKEN|env/i)
  })

  // The regression that started all this: never hand an object back to a caller
  // that is going to use it as a credential.
  it('never returns a non-string value', () => {
    for (const v of [
      { source: 'store', provider: 'default', id: 'X' },
      { source: 'nonsense', provider: 'default', id: 'X' },
      { nope: true },
      42,
    ]) {
      const r = resolveSecretRef(v as unknown)
      expect(r.value === null || typeof r.value === 'string').toBe(true)
    }
  })

  it('reports an unknown source rather than guessing', () => {
    const r = resolveSecretRef({ source: 'vault', provider: 'default', id: 'X' })
    expect(r.value).toBeNull()
    expect(r.reason).toMatch(/vault/)
  })
})
