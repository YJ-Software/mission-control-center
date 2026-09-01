import { describe, expect, it } from 'vitest'
import {
  configPathToPointer,
  planHardening,
  buildHardenedConfig,
  type AuditFinding,
} from '@/lib/openclaw/secret-hardening'

// A fresh OCD deploy leaves every credential as a plaintext string in
// openclaw.json — verified on the throwaway: no `secrets` block at all and
// gateway.auth.token a bare string. Anything that can read that file (an agent,
// a workspace tool) can read every key in it.
//
// OpenClaw's fix is a SecretRef pointing at a provider. This moves them into one
// json-mode file provider: a single 600 file holding every migrated secret,
// each addressed by a JSON pointer. json mode was verified against real
// OpenClaw 2026.8.2 on the throwaway (gateway 200, audit unresolved=0).
//
// Which fields to move is NOT hardcoded here — `openclaw secrets audit --json`
// already reports exactly which ones are plaintext, so the plan is derived from
// its findings and stays correct as OpenClaw adds secret-bearing fields.

const CFG = '/home/u/.openclaw/openclaw.json'

function finding(jsonPath: string, over: Partial<AuditFinding> = {}): AuditFinding {
  return { code: 'PLAINTEXT_FOUND', file: CFG, jsonPath, ...over }
}

describe('configPathToPointer', () => {
  it('converts a dotted path', () => {
    expect(configPathToPointer('gateway.auth.token')).toBe('/gateway/auth/token')
  })

  // The audit reports bracket-quoted segments for keys that are not plain
  // identifiers, e.g. a numeric telegram account id.
  it('converts bracket-quoted segments', () => {
    expect(configPathToPointer('channels.telegram.accounts["1005601933"].botToken')).toBe(
      '/channels/telegram/accounts/1005601933/botToken',
    )
  })

  // RFC 6901: ~ escapes to ~0 and / to ~1, or the pointer cannot round-trip.
  it('escapes ~ and / inside a segment', () => {
    expect(configPathToPointer('a["we/ird~key"].b')).toBe('/a/we~1ird~0key/b')
  })
})

describe('planHardening', () => {
  it('takes plaintext findings for openclaw.json and nothing else', () => {
    const plan = planHardening(
      [
        finding('gateway.auth.token'),
        finding('models.providers.google.apiKey'),
        // a different file — the sqlite auth store is out of scope
        finding('profiles.kimi.key', { file: '/home/u/.openclaw/state/openclaw.sqlite' }),
        // not a plaintext finding
        finding('models.providers.google.apiKey', { code: 'REF_SHADOWED' }),
      ],
      CFG,
    )
    expect(plan.map((t) => t.jsonPath)).toEqual([
      'gateway.auth.token',
      'models.providers.google.apiKey',
    ])
    expect(plan[0].pointer).toBe('/gateway/auth/token')
  })

  it('is empty when nothing is plaintext', () => {
    expect(planHardening([], CFG)).toEqual([])
  })

  it('de-duplicates repeated findings for the same field', () => {
    const plan = planHardening([finding('gateway.auth.token'), finding('gateway.auth.token')], CFG)
    expect(plan).toHaveLength(1)
  })
})

describe('buildHardenedConfig', () => {
  const base = () => ({
    gateway: { auth: { token: 'tok-plain' } },
    models: { providers: { google: { apiKey: 'AIza-plain' } } },
    channels: { telegram: { accounts: { '1005601933': { botToken: 'bot-plain' } } } },
  })

  const plan = [
    { jsonPath: 'gateway.auth.token', pointer: '/gateway/auth/token' },
    { jsonPath: 'models.providers.google.apiKey', pointer: '/models/providers/google/apiKey' },
    {
      jsonPath: 'channels.telegram.accounts["1005601933"].botToken',
      pointer: '/channels/telegram/accounts/1005601933/botToken',
    },
  ]

  it('replaces every planned field with a file SecretRef', () => {
    const { config } = buildHardenedConfig(base(), plan, {
      provider: 'bundle',
      path: '/home/u/.openclaw/secrets/secrets.json',
    })
    expect(config.gateway.auth.token).toEqual({
      source: 'file',
      provider: 'bundle',
      id: '/gateway/auth/token',
    })
    expect(config.channels.telegram.accounts['1005601933'].botToken).toEqual({
      source: 'file',
      provider: 'bundle',
      id: '/channels/telegram/accounts/1005601933/botToken',
    })
  })

  it('collects the plaintext values into the bundle under their pointers', () => {
    const { bundle } = buildHardenedConfig(base(), plan, {
      provider: 'bundle',
      path: '/home/u/.openclaw/secrets/secrets.json',
    })
    expect(bundle.gateway.auth.token).toBe('tok-plain')
    expect(bundle.channels.telegram.accounts['1005601933'].botToken).toBe('bot-plain')
  })

  it('declares the json-mode provider', () => {
    const { config } = buildHardenedConfig(base(), plan, {
      provider: 'bundle',
      path: '/home/u/.openclaw/secrets/secrets.json',
    })
    expect(config.secrets.providers.bundle).toEqual({
      source: 'file',
      path: '/home/u/.openclaw/secrets/secrets.json',
      mode: 'json',
    })
  })

  // Re-running must not wrap an existing ref into a ref, and must not lose the
  // value that is already in the bundle.
  it('is idempotent — a field that is already a ref is left alone', () => {
    const first = buildHardenedConfig(base(), plan, {
      provider: 'bundle',
      path: '/p.json',
    })
    const second = buildHardenedConfig(first.config, plan, {
      provider: 'bundle',
      path: '/p.json',
      existingBundle: first.bundle,
    })
    expect(second.config.gateway.auth.token).toEqual(first.config.gateway.auth.token)
    expect(second.bundle.gateway.auth.token).toBe('tok-plain')
    expect(second.moved).toBe(0)
  })

  it('reports how many fields it actually moved', () => {
    const r = buildHardenedConfig(base(), plan, { provider: 'bundle', path: '/p.json' })
    expect(r.moved).toBe(3)
  })

  it('skips a planned field that is missing from the config', () => {
    const cfg: Record<string, unknown> = { gateway: { auth: {} } }
    const r = buildHardenedConfig(cfg, [{ jsonPath: 'gateway.auth.token', pointer: '/x' }], {
      provider: 'b',
      path: '/p.json',
    })
    expect(r.moved).toBe(0)
  })

  it('preserves providers that were already configured', () => {
    const cfg = { ...base(), secrets: { providers: { other: { source: 'env' } } } }
    const { config } = buildHardenedConfig(cfg, plan, { provider: 'bundle', path: '/p.json' })
    expect(config.secrets.providers.other).toEqual({ source: 'env' })
    expect(config.secrets.providers.bundle).toBeTruthy()
  })
})
