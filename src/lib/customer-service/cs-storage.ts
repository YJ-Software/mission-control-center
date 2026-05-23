import { readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { settings, csMessages } from '@/lib/schema'
import { eq, lt, inArray, and, sql } from 'drizzle-orm'
import { CS_MEDIA_DIR } from './cs-media'

const KEYS = {
  retentionDays: 'customer-service.storage.retentionDays',  // number or 'never'
  warnThresholdMb: 'customer-service.storage.warnThresholdMb',
} as const

const DEFAULTS = {
  retentionDays: 'never' as string,   // operator picks 30/90/180/365/never
  warnThresholdMb: 1024,              // 1 GB default
}

function get(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? ''
}

function set(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export interface StorageSettings {
  retentionDays: number | 'never'
  warnThresholdMb: number
}

export function readStorageSettings(): StorageSettings {
  const r = get(KEYS.retentionDays) || DEFAULTS.retentionDays
  const t = Number(get(KEYS.warnThresholdMb)) || DEFAULTS.warnThresholdMb
  return {
    retentionDays: r === 'never' ? 'never' : (Number(r) || 30),
    warnThresholdMb: t,
  }
}

export function writeStorageSettings(patch: Partial<StorageSettings>): void {
  if (patch.retentionDays !== undefined) {
    const v = patch.retentionDays === 'never' ? 'never' : String(patch.retentionDays)
    set(KEYS.retentionDays, v)
  }
  if (patch.warnThresholdMb !== undefined) set(KEYS.warnThresholdMb, String(patch.warnThresholdMb))
}

export interface StorageStats {
  mediaBytes: number
  mediaFiles: number
  oldestMediaTs: number | null     // unix seconds, null if no files
}

export function getStorageStats(): StorageStats {
  let mediaBytes = 0
  let mediaFiles = 0
  let oldestMediaTs: number | null = null

  if (existsSync(CS_MEDIA_DIR)) {
    for (const name of readdirSync(CS_MEDIA_DIR)) {
      try {
        const p = join(CS_MEDIA_DIR, name)
        const s = statSync(p)
        if (s.isFile()) {
          mediaBytes += s.size
          mediaFiles += 1
          const ts = Math.floor(s.mtimeMs / 1000)
          if (oldestMediaTs === null || ts < oldestMediaTs) oldestMediaTs = ts
        }
      } catch { /* skip unreadable file */ }
    }
  }
  return { mediaBytes, mediaFiles, oldestMediaTs }
}

/**
 * Daily retention sweep. Deletes media files older than the configured
 * retention window and rewrites their cs_messages rows to a tombstone
 * (text='[檔案已逾保存期限]', type='deleted_media', payload=null).
 *
 * Text-only messages (type='text', no payload) are NEVER touched — they
 * cost essentially nothing and operators want full conversation history.
 *
 * Returns count of media rows tombstoned + file unlinks for logging.
 */
export function runRetentionSweep(): { tombstoned: number; unlinked: number; bytesFreed: number } {
  const s = readStorageSettings()
  if (s.retentionDays === 'never') return { tombstoned: 0, unlinked: 0, bytesFreed: 0 }

  const cutoff = Math.floor(Date.now() / 1000) - s.retentionDays * 86400
  const candidates = db.select().from(csMessages)
    .where(and(
      inArray(csMessages.type, ['image', 'video', 'audio', 'file', 'sticker']),
      lt(csMessages.createdAt, sql`${cutoff}`),
    ))
    .all() as Array<{ id: string; payload: string | null }>

  let unlinked = 0
  let bytesFreed = 0
  for (const r of candidates) {
    if (!r.payload) continue
    try {
      const p = JSON.parse(r.payload) as { storedFilename?: string; imageUrl?: string }
      const filename = p.storedFilename || extractStoredFilename(p.imageUrl)
      if (!filename) continue
      const filepath = join(CS_MEDIA_DIR, filename)
      if (existsSync(filepath)) {
        bytesFreed += statSync(filepath).size
        unlinkSync(filepath)
        unlinked += 1
      }
    } catch { /* skip malformed payload */ }
  }

  // Tombstone the rows so the conversation history still shows there was
  // a message, just with the media gone.
  if (candidates.length > 0) {
    db.update(csMessages)
      .set({ type: 'deleted_media', payload: null, text: '[檔案已逾保存期限]' })
      .where(inArray(csMessages.id, candidates.map(c => c.id)))
      .run()
  }
  return { tombstoned: candidates.length, unlinked, bytesFreed }
}

function extractStoredFilename(url?: string | null): string | null {
  if (!url) return null
  const m = url.match(/\/cs-media\/([a-f0-9-]{36}\.(?:jpg|png|gif|webp|mp4|m4a|pdf|bin))$/i)
  return m ? m[1] : null
}
