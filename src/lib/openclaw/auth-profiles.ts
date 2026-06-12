import { readFile, writeFile, readdir, rename, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import Database from 'better-sqlite3'

const AGENTS_ROOT = join(os.homedir(), '.openclaw', 'agents')

// OpenClaw 2026.6.5+ stores per-agent auth profiles in a SQLite DB
// (openclaw-agent.sqlite) instead of the legacy auth-profiles.json. The
// `auth_profile_store.store_json` column (store_key='primary') holds the SAME
// {version,profiles} shape — including raw keys — that the JSON file used to.
function authDbPath(agentId: string): string {
  return join(AGENTS_ROOT, agentId, 'agent', 'openclaw-agent.sqlite')
}

/** Read the openclaw SQLite auth store. Returns the parsed ProfilesFile (with
 * raw keys, same shape as the legacy JSON) or null if the DB / table / row is
 * absent or unreadable — callers fall back to the legacy auth-profiles.json. */
export function readAuthStoreDb(dbPath: string): ProfilesFile | null {
  if (!existsSync(dbPath)) return null
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db
      .prepare("SELECT store_json FROM auth_profile_store WHERE store_key = 'primary'")
      .get() as { store_json?: string } | undefined
    if (!row?.store_json) return null
    return JSON.parse(row.store_json) as ProfilesFile
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** Read the openclaw SQLite auth state store (cooldowns / usage). Returns null
 * if absent/unreadable (the table is empty on fresh installs). */
function readStateDb(dbPath: string): StateFile | null {
  if (!existsSync(dbPath)) return null
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db
      .prepare("SELECT state_json FROM auth_profile_state WHERE state_key = 'primary'")
      .get() as { state_json?: string } | undefined
    if (!row?.state_json) return null
    return JSON.parse(row.state_json) as StateFile
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/** Pick a provider's raw API key from a ProfilesFile, matching by `provider`
 * field or `<provider>:*` id (the suffix changed from `:default` to `:manual`
 * across openclaw versions). Returns null if not found. */
export function findProviderKey(profiles: ProfilesFile, provider: string): string | null {
  for (const [id, entry] of Object.entries(profiles.profiles ?? {})) {
    if (entry?.provider === provider || id.startsWith(`${provider}:`)) {
      return typeof entry?.key === 'string' ? entry.key : null
    }
  }
  return null
}

export interface AgentPaths {
  id: string
  profilesPath: string
  statePath: string
}

export interface ProfilesFile {
  version?: number
  profiles?: Record<string, AuthProfileEntry>
  lastGood?: Record<string, string> | null
  order?: unknown
  usageStats?: Record<string, unknown>
  [k: string]: unknown
}

export interface StateFile {
  version?: number
  lastGood?: Record<string, string>
  usageStats?: Record<string, ProfileUsage>
  [k: string]: unknown
}

export interface AuthProfileEntry {
  type: 'oauth' | 'api_key' | string
  provider: string
  email?: string
  key?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
  expiresAt?: number
  [k: string]: unknown
}

export interface ProfileUsage {
  lastUsed?: number
  cooldownUntil?: number
  cooldownReason?: string
  cooldownModel?: string
  errorCount?: number
  failureCounts?: Record<string, number>
  lastFailureAt?: number
}

const SAFE_AGENT_DIR = /^[a-zA-Z0-9_.-]+$/

export async function listAgents(): Promise<AgentPaths[]> {
  let entries: string[] = []
  try {
    entries = await readdir(AGENTS_ROOT)
  } catch {
    return []
  }
  const out: AgentPaths[] = []
  for (const id of entries) {
    // Skip anything that doesn't look like a clean agent id (e.g. hidden
    // files, stray dotfiles), so `find <agent>` doesn't accidentally surface
    // unrelated entries on a fresh install.
    if (!SAFE_AGENT_DIR.test(id)) continue
    const dir = join(AGENTS_ROOT, id)
    try {
      const s = await stat(dir)
      if (!s.isDirectory()) continue
    } catch {
      continue
    }
    out.push({
      id,
      profilesPath: join(dir, 'agent', 'auth-profiles.json'),
      statePath: join(dir, 'agent', 'auth-state.json'),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const dir = dirname(path)
  const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

/** Upsert the full profiles blob into the openclaw SQLite auth store. Mirrors
 * openclaw's storage model (single store_key='primary' row holding store_json).
 * Verified on a live openclaw 2026.6.5: a direct store_json write is reflected
 * immediately by `openclaw models auth list`. Returns false if the DB/table is
 * absent or the write fails (caller falls back to the legacy JSON file). */
export function writeAuthStoreDb(dbPath: string, profiles: ProfilesFile): boolean {
  if (!existsSync(dbPath)) return false
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { fileMustExist: true })
    db.pragma('busy_timeout = 4000')
    db.prepare(
      `INSERT INTO auth_profile_store (store_key, store_json, updated_at)
       VALUES ('primary', ?, ?)
       ON CONFLICT(store_key) DO UPDATE SET store_json = excluded.store_json, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(profiles), Date.now())
    return true
  } catch {
    return false
  } finally {
    db?.close()
  }
}

function writeStateDb(dbPath: string, state: StateFile): boolean {
  if (!existsSync(dbPath)) return false
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { fileMustExist: true })
    db.pragma('busy_timeout = 4000')
    db.prepare(
      `INSERT INTO auth_profile_state (state_key, state_json, updated_at)
       VALUES ('primary', ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(state), Date.now())
    return true
  } catch {
    return false
  } finally {
    db?.close()
  }
}

/** Persist profiles to whichever store the agent uses: the SQLite store if its
 * DB exists (openclaw 2026.6.5+), else the legacy auth-profiles.json. */
async function writeProfiles(agentId: string, profiles: ProfilesFile): Promise<void> {
  if (writeAuthStoreDb(authDbPath(agentId), profiles)) return
  await writeJsonAtomic(join(AGENTS_ROOT, agentId, 'agent', 'auth-profiles.json'), profiles)
}

async function writeStateStore(agentId: string, state: StateFile): Promise<void> {
  if (writeStateDb(authDbPath(agentId), state)) return
  await writeJsonAtomic(join(AGENTS_ROOT, agentId, 'agent', 'auth-state.json'), state)
}

export async function readProfiles(agentId: string): Promise<ProfilesFile> {
  // Prefer the openclaw 2026.6.5+ SQLite store; fall back to the legacy JSON
  // file for older openclaw installs.
  const fromDb = readAuthStoreDb(authDbPath(agentId))
  if (fromDb) return fromDb
  const p = join(AGENTS_ROOT, agentId, 'agent', 'auth-profiles.json')
  return readJson<ProfilesFile>(p, { version: 1, profiles: {} })
}

export async function readState(agentId: string): Promise<StateFile> {
  const fromDb = readStateDb(authDbPath(agentId))
  if (fromDb) return fromDb
  const p = join(AGENTS_ROOT, agentId, 'agent', 'auth-state.json')
  return readJson<StateFile>(p, { version: 1 })
}

export interface ProfileSummary {
  profileId: string
  provider: string
  type: string
  identity?: string
  expiresAt?: number
  cooldownUntil?: number
  status: 'active' | 'expired' | 'expiring' | 'cooldown'
}

const EXPIRING_WINDOW_MS = 24 * 60 * 60 * 1000

export function summarizeProfiles(
  profiles: ProfilesFile,
  state: StateFile,
  now: number = Date.now(),
): ProfileSummary[] {
  const entries = Object.entries(profiles.profiles ?? {})
  return entries.map(([profileId, entry]) => {
    const expiresAt = pickExpiry(entry)
    const usage = state.usageStats?.[profileId]
    const cooldownUntil = usage?.cooldownUntil
    let status: ProfileSummary['status'] = 'active'
    if (expiresAt != null && expiresAt <= now) status = 'expired'
    else if (expiresAt != null && expiresAt - now < EXPIRING_WINDOW_MS) status = 'expiring'
    else if (cooldownUntil != null && cooldownUntil > now) status = 'cooldown'
    return {
      profileId,
      provider: entry.provider ?? profileId.split(':')[0],
      type: entry.type ?? 'unknown',
      identity: entry.email ?? (typeof entry.accountId === 'string' ? entry.accountId : undefined),
      expiresAt,
      cooldownUntil,
      status,
    }
  })
}

function pickExpiry(entry: AuthProfileEntry): number | undefined {
  if (typeof entry.expires === 'number') return entry.expires
  if (typeof entry.expiresAt === 'number') return entry.expiresAt
  return undefined
}

export async function removeProfile(agentId: string, profileId: string): Promise<void> {
  const profiles = await readProfiles(agentId)
  const state = await readState(agentId)
  const provider = profileId.split(':')[0]

  if (profiles.profiles && profileId in profiles.profiles) {
    delete profiles.profiles[profileId]
  }
  if (profiles.lastGood && typeof profiles.lastGood === 'object') {
    if (provider in profiles.lastGood) delete (profiles.lastGood as Record<string, string>)[provider]
  }
  if (profiles.usageStats && profileId in profiles.usageStats) {
    delete profiles.usageStats[profileId]
  }
  await writeProfiles(agentId, profiles)

  if (state.lastGood && provider in state.lastGood) delete state.lastGood[provider]
  if (state.usageStats && profileId in state.usageStats) delete state.usageStats[profileId]
  await writeStateStore(agentId, state)
}

export async function copyProfile(
  profileId: string,
  fromAgent: string,
  toAgents: string[],
): Promise<void> {
  const src = await readProfiles(fromAgent)
  const entry = src.profiles?.[profileId]
  if (!entry) throw new Error(`profile not found: ${profileId} in agent ${fromAgent}`)
  const provider = entry.provider ?? profileId.split(':')[0]
  for (const agentId of toAgents) {
    if (agentId === fromAgent) continue
    const dst = await readProfiles(agentId)
    dst.profiles = dst.profiles ?? {}
    dst.profiles[profileId] = entry
    if (dst.lastGood && typeof dst.lastGood === 'object') {
      ;(dst.lastGood as Record<string, string>)[provider] = profileId
    }
    await writeProfiles(agentId, dst)
  }
}

export const AGENTS_ROOT_FOR_TESTS = AGENTS_ROOT
