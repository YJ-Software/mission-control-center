/**
 * Phase 2: poll-based watcher that sends new capture files into the wiki.
 *
 *   {vault}/raw/*.md         (link-capture skill output)
 *   {vault}/transcripts/*.md (youtube-transcript full transcripts)
 *
 * Two modes, decided by `wiki.dualWrite` setting:
 *   - false (single-write, fresh installs): vault path *is* the wiki vault.
 *     Skills already drop files inside it; we still ingest into sources/ so
 *     they get provenance + claims, but we skip files already inside
 *     `~/.openclaw/wiki/main/sources/` to avoid double-ingest.
 *   - true (dual-write, this dev box): vault is a separate Obsidian vault
 *     (e.g. ~/Documents/Obsidian Vault). Tee every new file into wiki sources/.
 *
 * We use polling instead of fs.watch because:
 *   - fs.watch recursive is unreliable on Linux (kernel inotify limits)
 *   - capture frequency is at most a few per hour — 30s polling is fine
 *   - polling state is crash-safe (we re-scan and dedupe by path+mtime)
 *
 * State (which files we've already ingested) lives in MCC's settings table
 * keyed by absolute path → mtime. Survives dashboard restarts.
 */

import { existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { ingest } from './cli'

const WIKI_VAULT = join(homedir(), '.openclaw', 'wiki', 'main')
const WIKI_SOURCES = join(WIKI_VAULT, 'sources')

const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null
let running = false

function getSetting(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value ?? ''
}

function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1).replace(/^\//, '')) : resolve(p)
}

interface SeenIndex { [path: string]: number }
function loadIndex(): SeenIndex {
  try { return JSON.parse(getSetting('wiki.watcher.seen') || '{}') } catch { return {} }
}
function saveIndex(idx: SeenIndex): void { setSetting('wiki.watcher.seen', JSON.stringify(idx)) }

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => join(dir, n))
  } catch { return [] }
}

async function pollOnce(): Promise<void> {
  if (running) return
  running = true
  try {
    const vaultPath = expandHome(getSetting('obsidian.vault_path') || WIKI_VAULT)
    const dualWrite = getSetting('wiki.dualWrite') === 'true'

    const candidates = [
      ...listMarkdown(join(vaultPath, 'raw')),
      ...listMarkdown(join(vaultPath, 'transcripts')),
    ]

    const wikiSourcesAbs = resolve(WIKI_SOURCES)
    const isInsideWikiSources = (p: string) => resolve(p).startsWith(wikiSourcesAbs)

    const seen = loadIndex()
    let changed = false

    for (const p of candidates) {
      // Avoid double-ingest in single-write: file already living inside wiki sources/.
      // (Captures land in raw/ or transcripts/ which are SIBLINGS of sources/, so this
      // mostly matters for dual-write where sources/ may also be searched in future.)
      if (!dualWrite && isInsideWikiSources(p)) continue

      let mtime: number
      try { mtime = statSync(p).mtimeMs } catch { continue }
      if (seen[p] === mtime) continue

      try {
        const result = await ingest(p)
        if (result.ok) {
          seen[p] = mtime
          changed = true
          console.log(`[wiki-watcher] ingested ${p}`)
        } else {
          console.warn(`[wiki-watcher] ingest failed for ${p}: ${result.output}`)
        }
      } catch (err: unknown) {
        console.warn('[wiki-watcher] ingest threw:', err instanceof Error ? err.message : err)
      }
    }

    // Drop entries pointing at files that no longer exist (vault cleanup).
    for (const k of Object.keys(seen)) {
      if (!existsSync(k)) { delete seen[k]; changed = true }
    }
    if (changed) saveIndex(seen)
  } finally {
    running = false
  }
}

/** Start the polling loop. Idempotent — repeated calls are no-ops. */
export function startWikiWatcher(): void {
  if (timer) return
  // Schedule slightly after boot so DB / openclaw aren't pummeled at startup.
  setTimeout(() => { pollOnce().catch(() => { /* swallow */ }) }, 5_000)
  timer = setInterval(() => { pollOnce().catch(() => { /* swallow */ }) }, POLL_INTERVAL_MS)
  console.log(`[wiki-watcher] started, polling every ${POLL_INTERVAL_MS / 1000}s`)
}

export function stopWikiWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}
