import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { db } from '@/lib/db'
import { csConversations, csMessages, csAgentPause } from '@/lib/schema'
import { eq, desc, sql, lt } from 'drizzle-orm'
import { getProfile, type LineProfile } from './line-api'

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000

/** Process-local bus for live dashboard updates. server.ts subscribes and
 *  forwards events over the /ws channel. Keep payloads small (no full
 *  message bodies in 'pause' events). */
export const csEventBus = new EventEmitter()
csEventBus.setMaxListeners(50)

export interface CsBusMessage {
  type: 'cs:new-message'
  payload: { userId: string; messageId: string; direction: string; preview: string; createdAt: number | null }
}
export interface CsBusPause {
  type: 'cs:pause-changed'
  payload: { userId: string; paused: boolean; resumeAt: number | null }
}
export type CsBusEvent = CsBusMessage | CsBusPause

export type Direction = 'user' | 'bot' | 'operator'
export type MessageType = 'text' | 'image' | 'sticker' | 'quick_reply' | 'other'

export interface ConversationRow {
  userId: string
  displayName: string | null
  pictureUrl: string | null
  language: string | null
  lastMessageAt: number | null
  lastMessagePreview: string | null
  lastDirection: string | null
  profileFetchedAt: number | null
  createdAt: number | null
}

export interface MessageRow {
  id: string
  userId: string
  direction: string
  type: string
  text: string | null
  payload: string | null
  lineMessageId: string | null
  operatorId: string | null
  createdAt: number | null
}

export interface RecordMessageInput {
  userId: string
  direction: Direction
  type?: MessageType
  text?: string
  payload?: unknown
  lineMessageId?: string
  operatorId?: string
}

function previewOf(input: RecordMessageInput): string {
  if (input.type === 'image') return '[圖片]'
  if (input.type === 'sticker') return '[貼圖]'
  return (input.text ?? '').slice(0, 80)
}

export function recordMessage(input: RecordMessageInput): MessageRow {
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const payloadJson = input.payload === undefined ? null : JSON.stringify(input.payload)

  db.insert(csMessages).values({
    id,
    userId: input.userId,
    direction: input.direction,
    type: input.type ?? 'text',
    text: input.text ?? null,
    payload: payloadJson,
    lineMessageId: input.lineMessageId ?? null,
    operatorId: input.operatorId ?? null,
  }).run()

  // Upsert conversation row — keep created_at on first sight, refresh preview always.
  const preview = previewOf(input)
  db.insert(csConversations).values({
    userId: input.userId,
    lastMessageAt: now,
    lastMessagePreview: preview,
    lastDirection: input.direction,
  }).onConflictDoUpdate({
    target: csConversations.userId,
    set: {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastDirection: input.direction,
    },
  }).run()

  const row: MessageRow = {
    id,
    userId: input.userId,
    direction: input.direction,
    type: input.type ?? 'text',
    text: input.text ?? null,
    payload: payloadJson,
    lineMessageId: input.lineMessageId ?? null,
    operatorId: input.operatorId ?? null,
    createdAt: now,
  }
  // Fire-and-forget bus event for live dashboard updates. server.ts forwards
  // this over /ws so connected UIs invalidate queries immediately instead of
  // waiting for the 3-5s polling tick.
  const evt: CsBusMessage = {
    type: 'cs:new-message',
    payload: { userId: row.userId, messageId: row.id, direction: row.direction, preview: previewOf(input), createdAt: row.createdAt },
  }
  csEventBus.emit('cs', evt)
  return row
}

export function listConversations(opts: { search?: string; limit?: number } = {}): ConversationRow[] {
  const limit = opts.limit ?? 100
  const all = db.select().from(csConversations)
    .orderBy(desc(csConversations.lastMessageAt))
    .limit(limit)
    .all() as ConversationRow[]
  if (!opts.search) return all
  const q = opts.search.toLowerCase()
  return all.filter(c =>
    c.userId.toLowerCase().includes(q)
    || (c.displayName?.toLowerCase().includes(q) ?? false)
    || (c.lastMessagePreview?.toLowerCase().includes(q) ?? false),
  )
}

export function getConversation(userId: string): ConversationRow | null {
  const row = db.select().from(csConversations)
    .where(eq(csConversations.userId, userId)).get() as ConversationRow | undefined
  return row ?? null
}

export function listMessages(userId: string, opts: { limit?: number; beforeId?: string } = {}): MessageRow[] {
  const limit = opts.limit ?? 100
  // Newest-first then reverse so callers see ascending order.
  const rows = db.select().from(csMessages)
    .where(eq(csMessages.userId, userId))
    .orderBy(desc(csMessages.createdAt))
    .limit(limit)
    .all() as MessageRow[]
  return rows.reverse()
}

export function upsertProfile(userId: string, profile: LineProfile | null): void {
  const now = Math.floor(Date.now() / 1000)
  if (!profile) {
    // Mark fetch attempt so we don't retry too fast for a user who unfriended.
    db.update(csConversations)
      .set({ profileFetchedAt: now })
      .where(eq(csConversations.userId, userId)).run()
    return
  }
  db.insert(csConversations).values({
    userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl ?? null,
    language: profile.language ?? null,
    profileFetchedAt: now,
  }).onConflictDoUpdate({
    target: csConversations.userId,
    set: {
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl ?? null,
      language: profile.language ?? null,
      profileFetchedAt: now,
    },
  }).run()
}

/**
 * Lazy-refresh: fetch LINE profile if we don't have one yet, or the cache
 * is >24h old. Failures are swallowed (best-effort hydration; UI falls back
 * to user_id rendering).
 */
export async function maybeRefreshProfile(userId: string, force = false): Promise<void> {
  const conv = getConversation(userId)
  const now = Date.now()
  const stale = !conv?.profileFetchedAt || (now - (conv.profileFetchedAt ?? 0) * 1000) > PROFILE_TTL_MS
  if (!force && conv?.displayName && !stale) return
  try {
    const profile = await getProfile(userId)
    upsertProfile(userId, profile)
  } catch {
    // ignore — keep stale data, retry later
  }
}

// --- pause / resume ---

export interface PauseRow {
  userId: string
  pausedAt: number
  resumeAt: number
  operatorId: string | null
}

export function getPause(userId: string): PauseRow | null {
  const row = db.select().from(csAgentPause)
    .where(eq(csAgentPause.userId, userId)).get() as PauseRow | undefined
  return row ?? null
}

export function isPaused(userId: string): boolean {
  const row = getPause(userId)
  if (!row) return false
  return row.resumeAt * 1000 > Date.now()
}

export function setPause(userId: string, durationMs: number, operatorId?: string): PauseRow {
  const now = Math.floor(Date.now() / 1000)
  const resumeAt = now + Math.floor(durationMs / 1000)
  db.insert(csAgentPause).values({
    userId,
    pausedAt: now,
    resumeAt,
    operatorId: operatorId ?? null,
  }).onConflictDoUpdate({
    target: csAgentPause.userId,
    set: { resumeAt, operatorId: operatorId ?? null },
  }).run()
  csEventBus.emit('cs', { type: 'cs:pause-changed', payload: { userId, paused: true, resumeAt } } as CsBusPause)
  return { userId, pausedAt: now, resumeAt, operatorId: operatorId ?? null }
}

export function clearPause(userId: string): void {
  db.delete(csAgentPause).where(eq(csAgentPause.userId, userId)).run()
  csEventBus.emit('cs', { type: 'cs:pause-changed', payload: { userId, paused: false, resumeAt: null } } as CsBusPause)
}

export function listActivePauses(): PauseRow[] {
  const now = Math.floor(Date.now() / 1000)
  return db.select().from(csAgentPause)
    .all()
    .filter((r: PauseRow) => r.resumeAt > now) as PauseRow[]
}

export function purgeExpiredPauses(): number {
  const now = Math.floor(Date.now() / 1000)
  const res = db.delete(csAgentPause).where(lt(csAgentPause.resumeAt, sql`${now}`)).run()
  return res.changes ?? 0
}
