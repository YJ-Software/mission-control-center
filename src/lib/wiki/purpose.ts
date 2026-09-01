/**
 * Single source of truth for "what is the wiki for".
 *
 * The OpenClaw memory-wiki plugin is global: one vault, one memory slot, one
 * embedding config per machine. Two features want it for different things —
 * the Second Brain (Agent knowledge base) and Customer Service (support agent
 * knowledge base). They can't both own the global config, so the user picks
 * ONE purpose and we apply a single coherent openclaw.json shape for it.
 *
 * `wiki.purpose` (SQLite settings) is the authoritative choice. Both the
 * second-brain setup flow and the customer-service flow resolve their config
 * through `applyPurposeToConfig` so they can never write contradictory values.
 *
 * Slot/plugin layout per purpose (validated on a live OpenClaw 2026.6.8):
 *   agent            → slot=memory-lancedb, lancedb ON (semantic recall + wiki
 *                      semantic search via backend "shared").
 *   customer-service → slot=memory-wiki (knowledge digest injected in prompt),
 *                      lancedb OFF — a non-slot memory plugin is disabled by
 *                      OpenClaw anyway, so there's no semantic-search benefit to
 *                      keeping it on. Wiki search is local/text; customer
 *                      profiles go through mem0. Semantic retrieval for a large
 *                      CS knowledge base would need slot=memory-lancedb, a
 *                      separate regime we don't default to.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { getServerEnv } from '@/lib/server-env'
import { allowPlugins } from '@/lib/plugins/allowlist'
import {
  ensurePluginConsented,
  realPluginProbe,
  type ConsentLog,
  type PluginProbe,
} from '@/lib/openclaw/plugin-consent'

const execFileAsync = promisify(execFile)

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')
const WIKI_VAULT_PATH = '~/.openclaw/wiki/main'

export const PURPOSE_KEY = 'wiki.purpose'

export type WikiPurpose = 'agent' | 'customer-service'

export function isWikiPurpose(v: unknown): v is WikiPurpose {
  return v === 'agent' || v === 'customer-service'
}

// --- SQLite settings helpers ---

function getSetting(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value
}

function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

// --- openclaw.json helpers (backup on every write, same as setup.ts) ---

function readOpenclawJson(): Record<string, any> {
  if (!existsSync(OPENCLAW_JSON)) return {}
  return JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8'))
}

function writeOpenclawJson(obj: Record<string, any>): void {
  if (existsSync(OPENCLAW_JSON)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    copyFileSync(OPENCLAW_JSON, `${OPENCLAW_JSON}.bak.mcc-purpose-${ts}`)
  }
  mkdirSync(dirname(OPENCLAW_JSON), { recursive: true })
  writeFileSync(OPENCLAW_JSON, JSON.stringify(obj, null, 2))
}

/**
 * Apply the plugin config for a given purpose, in place, and return the config.
 *
 * Shared by setup.ts (Agent purpose) and the customer-service flow so the two
 * can never disagree on slot / lancedb / search settings. Preserves unrelated
 * keys (vault path, obsidian, ingest, render, embedding) so it's safe to call
 * over an existing config.
 */
export function applyPurposeToConfig(cfg: Record<string, any>, purpose: WikiPurpose): Record<string, any> {
  cfg.plugins ??= {}
  cfg.plugins.entries ??= {}
  cfg.plugins.slots ??= {}

  // Permit both memory plugins — but only extend an ALREADY-active allowlist.
  // Materialising one from an empty list would silently block Telegram and
  // every other unlisted plugin (see allowlist.ts). The plugins are enabled via
  // their entries regardless of the allowlist.
  allowPlugins(cfg, ['memory-lancedb', 'memory-wiki'])
  // If an allowlist is active, memory-lancedb-pro / memory-core must not sit in
  // it (they fight the slot). No-op on an inert (empty/absent) allowlist.
  if (Array.isArray(cfg.plugins.allow) && cfg.plugins.allow.length > 0) {
    cfg.plugins.allow = cfg.plugins.allow.filter(
      (id: string) => id !== 'memory-lancedb-pro' && id !== 'memory-core',
    )
  }

  // --- memory-lancedb: embedding base is identical; only auto-* differs. ---
  const prevLance = cfg.plugins.entries['memory-lancedb'] ?? {}
  const prevLanceCfg = prevLance.config ?? {}
  // memory-lancedb only does anything when it IS the active memory slot —
  // OpenClaw disables a non-slot memory plugin. So lancedb is enabled ONLY in
  // the agent purpose (where it's the slot, providing semantic recall + wiki
  // semantic search). In customer-service the slot is memory-wiki, so lancedb
  // can't contribute and is left disabled; the embedding config is preserved
  // for a clean switch back to agent. Customer memory goes through mem0.
  const lanceActive = purpose === 'agent'
  cfg.plugins.entries['memory-lancedb'] = {
    ...prevLance,
    enabled: lanceActive,
    config: {
      ...prevLanceCfg,
      embedding: {
        apiKey: 'ollama-no-key-needed',
        model: 'bge-m3',
        baseUrl: 'http://127.0.0.1:11434/v1',
        dimensions: 1024,
        ...(prevLanceCfg.embedding ?? {}),
      },
      dbPath: prevLanceCfg.dbPath ?? '~/.openclaw/memory/lancedb',
      autoCapture: lanceActive,
      autoRecall: lanceActive,
    },
  }

  // --- memory-wiki: same vault + render in both; search backend differs. ---
  //   agent            → backend "shared" leans on lancedb (the slot) for
  //                      semantic wiki search across wiki+memory.
  //   customer-service → backend "local", wiki-only text search (no lancedb to
  //                      lean on); the wiki knowledge digest is injected in the
  //                      agent's prompt because memory-wiki is the slot.
  const prevWiki = cfg.plugins.entries['memory-wiki'] ?? {}
  const prevWikiCfg = prevWiki.config ?? {}
  cfg.plugins.entries['memory-wiki'] = {
    ...prevWiki,
    enabled: true,
    config: {
      ...prevWikiCfg,
      vaultMode: prevWikiCfg.vaultMode ?? 'isolated',
      vault: { path: WIKI_VAULT_PATH, renderMode: 'obsidian', ...(prevWikiCfg.vault ?? {}) },
      obsidian: {
        enabled: true,
        useOfficialCli: true,
        vaultName: 'OpenClaw Wiki',
        openAfterWrites: false,
        ...(prevWikiCfg.obsidian ?? {}),
      },
      ingest: { autoCompile: true, maxConcurrentJobs: 1, allowUrlIngest: true, ...(prevWikiCfg.ingest ?? {}) },
      search: lanceActive
        ? { backend: 'shared', corpus: 'all' }
        : { backend: 'local', corpus: 'wiki' },
      render: { preserveHumanBlocks: true, createBacklinks: true, createDashboards: true, ...(prevWikiCfg.render ?? {}) },
    },
  }

  // The memory slot flips the agent's primary memory:
  //   agent            → lancedb is the live memory (semantic recall of everything)
  //   customer-service → wiki is the in-prompt knowledge supplement; customer
  //                      profiles live in mem0; lancedb is disabled (see above).
  cfg.plugins.slots.memory = purpose === 'agent' ? 'memory-lancedb' : 'memory-wiki'

  // Drop stale entries that fight the slot setting.
  delete cfg.plugins.entries['memory-lancedb-pro']
  delete cfg.plugins.entries['memory-core']

  return cfg
}

/** Infer the purpose from an existing openclaw.json when no setting is stored. */
function inferPurpose(): WikiPurpose {
  try {
    const c = readOpenclawJson()
    if (c?.plugins?.slots?.memory === 'memory-wiki') return 'customer-service'
  } catch {
    /* fall through to default */
  }
  return 'agent'
}

/**
 * The current purpose. Reads the stored setting; if absent, infers from
 * openclaw.json (memory-wiki slot ⇒ customer-service, else agent) and persists
 * the inference so subsequent reads are stable.
 */
export function getPurpose(): WikiPurpose {
  const stored = getSetting(PURPOSE_KEY)
  if (isWikiPurpose(stored)) return stored
  const inferred = inferPurpose()
  setSetting(PURPOSE_KEY, inferred)
  return inferred
}

async function restartGateway(): Promise<string> {
  try {
    const r = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60_000, env: getServerEnv() })
    return (r.stdout || '') + (r.stderr || '')
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}

/**
 * Switch the wiki purpose: persist the choice, rewrite openclaw.json's plugin
 * block coherently, and restart the gateway so it takes effect.
 *
 * Customer-service mode ALSO needs the mem0 AGENTS.md block applied — that lives
 * in customer-service/memory-backend. Callers that switch to customer-service
 * should invoke that step too (the customer-service API route does).
 */
/** The EXTERNAL plugin a purpose needs before its config can be applied.
 *
 * memory-wiki ships with OpenClaw (stock:memory-wiki/index.js), so only the
 * agent purpose has anything to install. */
export function requiredExternalPlugin(
  purpose: WikiPurpose,
): { id: string; pkg: string } | null {
  return purpose === 'agent' ? { id: 'memory-lancedb', pkg: '@openclaw/memory-lancedb' } : null
}

/** Install + consent to the purpose's external plugin before anything enables
 * it in openclaw.json.
 *
 * Without this, applying the agent purpose writes
 * plugins.entries["memory-lancedb"].enabled = true and points
 * plugins.slots.memory at it, and OpenClaw 2026.8.1 then refuses to report the
 * gateway ready ("requires capability consent") and restart-loops. Returns 0
 * to continue; non-zero means the caller must NOT write the config. */
export async function ensurePurposePlugins(
  purpose: WikiPurpose,
  probe: PluginProbe = realPluginProbe,
  log: ConsentLog = () => {},
): Promise<number> {
  const required = requiredExternalPlugin(purpose)
  if (!required) return 0
  return ensurePluginConsented(required.id, required.pkg, probe, log)
}

export async function setPurpose(purpose: WikiPurpose): Promise<{ output: string }> {
  if (!existsSync(OPENCLAW_JSON)) throw new Error('openclaw.json missing — run the wiki install wizard first')

  // Before anything is written: the config below enables an external plugin and
  // then restarts the gateway. If the plugin is not consented, that restart
  // never comes back.
  const notes: string[] = []
  const consent = await ensurePurposePlugins(purpose, realPluginProbe, (_s, t) => notes.push(t))
  if (consent !== 0) {
    throw new Error(
      `無法啟用 ${requiredExternalPlugin(purpose)?.id}（capability consent 失敗）。` +
        `已停止套用，openclaw.json 未變更、gateway 未重啟 —— 否則 gateway 會拒絕啟動並無限重啟。\n` +
        notes.join('\n'),
    )
  }

  setSetting(PURPOSE_KEY, purpose)

  const cfg = readOpenclawJson()
  applyPurposeToConfig(cfg, purpose)
  // memory.backend is the wrong key (legacy) — strip if present.
  if (cfg.memory && typeof cfg.memory === 'object' && 'backend' in cfg.memory) {
    delete cfg.memory.backend
    if (Object.keys(cfg.memory).length === 0) delete cfg.memory
  }
  writeOpenclawJson(cfg)

  const restart = await restartGateway()
  return { output: `wiki.purpose = ${purpose}; openclaw.json updated\n${restart}` }
}
