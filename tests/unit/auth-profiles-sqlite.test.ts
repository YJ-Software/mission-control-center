import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAuthStoreDb, findProviderKey } from '@/lib/openclaw/auth-profiles'

// OpenClaw 2026.6.5 moved the per-agent auth store from auth-profiles.json into
// openclaw-agent.sqlite (table auth_profile_store, store_key='primary',
// store_json = the same {version,profiles} shape). These tests pin MCC's reader
// against that store so the kimi-add verification + the LLM-management list work.

function makeDb(dir: string, name: string, storeJson: unknown | null): string {
  const p = join(dir, name)
  const db = new Database(p)
  db.exec(
    'CREATE TABLE auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT, updated_at INTEGER)',
  )
  if (storeJson) {
    db.prepare('INSERT INTO auth_profile_store (store_key, store_json) VALUES (?, ?)').run(
      'primary',
      JSON.stringify(storeJson),
    )
  }
  db.close()
  return p
}

describe('readAuthStoreDb', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'authdb-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads profiles (with raw keys) from the sqlite store_json', () => {
    const store = {
      version: 1,
      profiles: {
        'kimi:manual': { type: 'api_key', provider: 'kimi', key: 'sk-kimi-x' },
        'google:manual': { type: 'api_key', provider: 'google', key: 'AIza-x' },
      },
    }
    const p = makeDb(dir, 'ok.sqlite', store)
    const got = readAuthStoreDb(p)
    expect(got?.profiles?.['kimi:manual']?.key).toBe('sk-kimi-x')
    expect(got?.profiles?.['google:manual']?.provider).toBe('google')
  })

  it('returns null when the db file does not exist (caller falls back to JSON)', () => {
    expect(readAuthStoreDb(join(dir, 'nope.sqlite'))).toBeNull()
  })

  it('returns null when the auth_profile_store table is missing', () => {
    const p = join(dir, 'empty.sqlite')
    new Database(p).close()
    expect(readAuthStoreDb(p)).toBeNull()
  })

  it('returns null when there is no primary row', () => {
    const p = makeDb(dir, 'norow.sqlite', null)
    expect(readAuthStoreDb(p)).toBeNull()
  })
})

describe('findProviderKey', () => {
  const profiles = {
    version: 1,
    profiles: {
      'google:manual': { type: 'api_key', provider: 'google', key: 'AIza-x' },
      'kimi:manual': { type: 'api_key', provider: 'kimi', key: 'sk' },
    },
  }

  it('finds the provider key regardless of :default vs :manual suffix', () => {
    expect(findProviderKey(profiles, 'google')).toBe('AIza-x')
    expect(findProviderKey(profiles, 'kimi')).toBe('sk')
  })

  it('returns null when the provider is absent', () => {
    expect(findProviderKey({ version: 1, profiles: {} }, 'google')).toBeNull()
  })
})
