import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  invalidateStoredProfiles,
  listStoredProfiles,
  withStoreOnlyProfiles,
  type ProfileSummary,
} from '@/lib/openclaw/auth-profiles'

// On OpenClaw 2026.9.4 `models auth logout` removes the openclaw.json entry and
// then fails to remove the stored credential. The LLM page listed profiles from
// openclaw.json only, so after the failed delete the still-live credential
// vanished from the dashboard with no way to delete it again.

const LIST_JSON = JSON.stringify({
  agentId: 'main',
  agentDir: '~/.openclaw/agents/main/agent',
  authStatePath: '~/.openclaw/state/openclaw.sqlite',
  provider: null,
  profiles: [
    { id: 'qwen-portal:manual', provider: 'qwen-portal', type: 'api_key', label: 'qwen-portal:manual' },
    { id: 'kimi:manual', provider: 'kimi', type: 'api_key', label: 'kimi:manual' },
  ],
})

describe('listStoredProfiles', () => {
  let dir: string
  let configBacked: string
  let legacy: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'authstore-'))
    configBacked = join(dir, 'cfg.json')
    writeFileSync(configBacked, JSON.stringify({ auth: { profiles: { 'qwen-portal:manual': { provider: 'qwen-portal', mode: 'api_key' } } } }))
    legacy = join(dir, 'legacy.json')
    writeFileSync(legacy, JSON.stringify({ models: { providers: {} } }))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  beforeEach(() => invalidateStoredProfiles())

  it('reads ids, providers and types from `models auth list --json`', async () => {
    const calls: string[][] = []
    const stored = await listStoredProfiles('main', {
      configPath: configBacked,
      run: async (args) => {
        calls.push(args)
        // openclaw can print a Doctor-warnings box ahead of the JSON
        return { code: 0, stdout: `│ Doctor warnings │\n${LIST_JSON}\n` }
      },
    })
    expect(calls).toEqual([['models', 'auth', 'list', '--agent', 'main', '--json']])
    expect(stored).toEqual([
      { id: 'qwen-portal:manual', provider: 'qwen-portal', type: 'api_key' },
      { id: 'kimi:manual', provider: 'kimi', type: 'api_key' },
    ])
  })

  it('answers null when the CLI fails or prints no JSON', async () => {
    expect(await listStoredProfiles('a', { configPath: configBacked, run: async () => ({ code: 1, stdout: '' }) })).toBeNull()
    expect(await listStoredProfiles('b', { configPath: configBacked, run: async () => ({ code: 0, stdout: 'nope' }) })).toBeNull()
  })

  it('does not spawn the CLI on pre-2026.8.1 stores', async () => {
    let called = false
    const r = await listStoredProfiles('main', { configPath: legacy, run: async () => { called = true; return { code: 0, stdout: LIST_JSON } } })
    expect(r).toBeNull()
    expect(called).toBe(false)
  })

  it('reuses a listing within the TTL and relists after invalidation', async () => {
    let calls = 0
    const run = async () => { calls++; return { code: 0, stdout: LIST_JSON } }
    await listStoredProfiles('main', { configPath: configBacked, run, now: 1_000 })
    await listStoredProfiles('main', { configPath: configBacked, run, now: 30_000 })
    expect(calls).toBe(1)
    await listStoredProfiles('main', { configPath: configBacked, run, now: 62_000 })
    expect(calls).toBe(2)
    invalidateStoredProfiles()
    await listStoredProfiles('main', { configPath: configBacked, run, now: 62_001 })
    expect(calls).toBe(3)
  })
})

describe('withStoreOnlyProfiles', () => {
  const qwen: ProfileSummary = { profileId: 'qwen-portal:manual', provider: 'qwen-portal', type: 'api_key', status: 'active' }

  it('appends stored profiles missing from openclaw.json, flagged storeOnly', () => {
    expect(withStoreOnlyProfiles([qwen], [
      { id: 'qwen-portal:manual', provider: 'qwen-portal', type: 'api_key' },
      { id: 'kimi:manual', provider: 'kimi', type: 'api_key' },
    ])).toEqual([
      qwen,
      { profileId: 'kimi:manual', provider: 'kimi', type: 'api_key', status: 'active', storeOnly: true },
    ])
  })

  it('leaves the list untouched when there is nothing to reconcile', () => {
    const list = [qwen]
    expect(withStoreOnlyProfiles(list, null)).toBe(list)
    expect(withStoreOnlyProfiles(list, [{ id: 'qwen-portal:manual' }])).toBe(list)
  })

  it('does not flag config-only profiles as a problem', () => {
    // openclaw.json can list a profile the store lacks (qwen-portal:default on
    // an OCD deploy); that is not a hidden credential, so nothing is added.
    const def: ProfileSummary = { ...qwen, profileId: 'qwen-portal:default' }
    expect(withStoreOnlyProfiles([def, qwen], [{ id: 'qwen-portal:manual' }])).toEqual([def, qwen])
  })

  it('derives the provider from the id when the CLI omits it', () => {
    expect(withStoreOnlyProfiles([], [{ id: 'deepseek:manual' }])[0]).toMatchObject({ provider: 'deepseek', type: 'unknown', storeOnly: true })
  })
})
