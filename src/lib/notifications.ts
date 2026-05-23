import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { notifications } from '@/lib/schema'
import { eq, desc, isNull, sql } from 'drizzle-orm'
import { emitBus } from '@/lib/event-bus'

export type NotificationType =
  | 'mcc-upgrade'
  | 'openclaw-upgrade'
  | 'cs-storage'
  | 'system'

export type NotificationSeverity = 'info' | 'warning' | 'error'

export interface NotificationRow {
  id: string
  type: string
  severity: string
  title: string
  body: string | null
  link: string | null
  dedupKey: string | null
  createdAt: number | null
  readAt: number | null
}

export interface CreateNotificationInput {
  type: NotificationType
  severity?: NotificationSeverity
  title: string
  body?: string
  link?: string
  /** When set, an existing UNREAD notification with the same dedupKey is
   *  reused (no new row, no new toast). Use for things like the daily
   *  storage-warning so the bell doesn't get spammed. */
  dedupKey?: string
}

export function createNotification(input: CreateNotificationInput): NotificationRow | null {
  if (input.dedupKey) {
    const existing = db.select().from(notifications)
      .where(eq(notifications.dedupKey, input.dedupKey))
      .all() as NotificationRow[]
    const unread = existing.find(n => n.readAt === null)
    if (unread) return null  // already pending — do not re-toast
  }

  const id = randomUUID()
  const severity = input.severity ?? 'info'
  db.insert(notifications).values({
    id,
    type: input.type,
    severity,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    dedupKey: input.dedupKey ?? null,
  }).run()

  const createdAt = Math.floor(Date.now() / 1000)
  emitBus({
    type: 'notification:new',
    payload: { id, severity, title: input.title, body: input.body ?? null, link: input.link ?? null, createdAt },
  })
  return {
    id,
    type: input.type,
    severity,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    dedupKey: input.dedupKey ?? null,
    createdAt,
    readAt: null,
  }
}

export function listNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}): NotificationRow[] {
  const limit = opts.limit ?? 50
  if (opts.unreadOnly) {
    return db.select().from(notifications)
      .where(isNull(notifications.readAt))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all() as NotificationRow[]
  }
  return db.select().from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all() as NotificationRow[]
}

export function unreadCount(): number {
  const rows = db.select({ c: sql<number>`COUNT(*)` }).from(notifications)
    .where(isNull(notifications.readAt))
    .all()
  return Number(rows[0]?.c ?? 0)
}

export function markRead(id: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.update(notifications).set({ readAt: now }).where(eq(notifications.id, id)).run()
}

export function markAllRead(): void {
  const now = Math.floor(Date.now() / 1000)
  db.update(notifications).set({ readAt: now }).where(isNull(notifications.readAt)).run()
}

export function deleteNotification(id: string): void {
  db.delete(notifications).where(eq(notifications.id, id)).run()
  emitBus({ type: 'notification:cleared', payload: { all: false, id } })
}

export function clearAll(): void {
  db.delete(notifications).run()
  emitBus({ type: 'notification:cleared', payload: { all: true } })
}
