import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readAuthProfilesFromConfig,
  chooseProfiles,
  buildLogoutArgs,
  removeProfile,
  type ProfilesFile,
} from '@/lib/openclaw/auth-profiles'

// OpenClaw 2026.8.1 moved auth profiles AGAIN: out of the per-agent
// openclaw-agent.sqlite (2026.6.5's home) and back into openclaw.json under
// `auth.profiles`. The sqlite file is left on disk, so a reader that only knows
// the sqlite store does not error — it just sees zero profiles. That made the
// "resolve new profile" phase of the paste-api-key job report failure for a key
// that had in fact been saved correctly, so the UI showed 登入失敗 on success.
//
// Config entries carry `mode` where the sqlite/JSON stores carried `type`, and
// no raw key (2026.8.1 keeps the secret behind a keyRef).

function writeConfig(dir: string, name: string, cfg: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(cfg))
  return p
}

describe('readAuthProfilesFromConfig', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'authcfg-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads auth.profiles out of openclaw.json', () => {
    const p = writeConfig(dir, 'ok.json', {
      auth: {
        profiles: {
          'kimi:manual': { provider: 'kimi', mode: 'api_key' },
          'qwen-portal:default': { provider: 'qwen-portal', mode: 'api_key' },
        },
      },
    })
    const got = readAuthProfilesFromConfig(p)
    expect(Object.keys(got?.profiles ?? {})).toEqual(['kimi:manual', 'qwen-portal:default'])
    expect(got?.profiles?.['kimi:manual'].provider).toBe('kimi')
  })

  it('maps 2026.8.1 `mode` onto the `type` field the UI summarises on', () => {
    const p = writeConfig(dir, 'mode.json', {
      auth: { profiles: { 'kimi:manual': { provider: 'kimi', mode: 'api_key' } } },
    })
    // Without this the LLM-management list renders every profile as "unknown".
    expect(readAuthProfilesFromConfig(p)?.profiles?.['kimi:manual'].type).toBe('api_key')
  })

  it('keeps an explicit `type` when the config already carries one', () => {
    const p = writeConfig(dir, 'type.json', {
      auth: { profiles: { 'google:manual': { provider: 'google', type: 'oauth' } } },
    })
    expect(readAuthProfilesFromConfig(p)?.profiles?.['google:manual'].type).toBe('oauth')
  })

  it('infers provider from the profile id when the entry omits it', () => {
    const p = writeConfig(dir, 'noprov.json', {
      auth: { profiles: { 'deepseek:manual': { mode: 'api_key' } } },
    })
    expect(readAuthProfilesFromConfig(p)?.profiles?.['deepseek:manual'].provider).toBe('deepseek')
  })

  // Returning null (not an empty ProfilesFile) is what lets readProfiles fall
  // through to the sqlite store on pre-2026.8.1 installs.
  it('returns null when the config has no auth.profiles (older openclaw)', () => {
    const p = writeConfig(dir, 'none.json', { models: { providers: {} } })
    expect(readAuthProfilesFromConfig(p)).toBeNull()
  })

  it('returns null when auth.profiles is present but empty', () => {
    const p = writeConfig(dir, 'empty.json', { auth: { profiles: {} } })
    expect(readAuthProfilesFromConfig(p)).toBeNull()
  })

  it('returns null for a missing file', () => {
    expect(readAuthProfilesFromConfig(join(dir, 'nope.json'))).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, '{ not json')
    expect(readAuthProfilesFromConfig(p)).toBeNull()
  })

  it('ignores a non-object auth.profiles', () => {
    const p = writeConfig(dir, 'weird.json', { auth: { profiles: 'nope' } })
    expect(readAuthProfilesFromConfig(p)).toBeNull()
  })
})

describe('chooseProfiles', () => {
  const cfg: ProfilesFile = { profiles: { 'kimi:manual': { type: 'api_key', provider: 'kimi' } } }
  const db: ProfilesFile = { profiles: { 'stale:manual': { type: 'api_key', provider: 'stale' } } }
  const legacy: ProfilesFile = { version: 1, profiles: {} }

  // A box upgraded from 2026.7 keeps its populated sqlite store while openclaw
  // has moved on to reading the config, so config has to win — otherwise the
  // dashboard shows profiles openclaw no longer uses.
  it('prefers the config store over a stale sqlite store', () => {
    expect(chooseProfiles(cfg, db, legacy)).toBe(cfg)
  })

  it('falls back to the sqlite store on pre-2026.8.1 openclaw', () => {
    expect(chooseProfiles(null, db, legacy)).toBe(db)
  })

  it('falls back to the legacy JSON when neither newer store has anything', () => {
    expect(chooseProfiles(null, null, legacy)).toBe(legacy)
  })
})

describe('buildLogoutArgs', () => {
  // Removal has to go through the CLI: on 2026.8.1 the profile lives in
  // openclaw.json behind a keyRef, so writing the sqlite store (what
  // removeProfile used to do) leaves the profile in place and the UI's delete
  // button silently does nothing.
  it('builds the documented `models auth logout` invocation', () => {
    expect(buildLogoutArgs('main', 'kimi:manual')).toEqual([
      'models',
      'auth',
      '--agent',
      'main',
      'logout',
      'kimi:manual',
      '--yes',
    ])
  })
})

describe('removeProfile on a config-backed store', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'authrm-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('delegates to the CLI when openclaw.json owns the profiles', async () => {
    const configPath = writeConfig(dir, 'cfg.json', {
      auth: { profiles: { 'kimi:manual': { provider: 'kimi', mode: 'api_key' } } },
    })
    const calls: string[][] = []
    await removeProfile('main', 'kimi:manual', {
      configPath,
      run: async (args) => {
        calls.push(args)
        return 0
      },
    })
    expect(calls).toEqual([buildLogoutArgs('main', 'kimi:manual')])
  })

  // A silent failure here is what leaves the E2E cleanup non-idempotent: the
  // next run finds a leftover kimi profile and asserts against the wrong row.
  it('throws when the CLI reports a non-zero exit', async () => {
    const configPath = writeConfig(dir, 'cfg-fail.json', {
      auth: { profiles: { 'kimi:manual': { provider: 'kimi', mode: 'api_key' } } },
    })
    await expect(
      removeProfile('main', 'kimi:manual', { configPath, run: async () => 1 }),
    ).rejects.toThrow(/logout kimi:manual failed \(exit 1\)/)
  })

  it('does not touch the CLI on pre-2026.8.1 stores', async () => {
    const configPath = writeConfig(dir, 'cfg-old.json', { models: { providers: {} } })
    let called = false
    // No agent dir exists under this temp home, so the legacy path is a no-op
    // write — all we assert is that the CLI branch was not taken.
    await removeProfile('does-not-exist', 'kimi:manual', {
      configPath,
      run: async () => {
        called = true
        return 0
      },
    }).catch(() => {})
    expect(called).toBe(false)
  })
})
