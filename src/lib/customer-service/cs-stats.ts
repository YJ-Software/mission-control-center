import { db } from '@/lib/db'
import { csConversations, csMessages, csAgentPause } from '@/lib/schema'
import { and, eq, sql, gt, isNull } from 'drizzle-orm'
import { getStorageStats, readStorageSettings } from './cs-storage'

const HOUR = 3600
const DAY = 86400

export interface CsStats {
  conversationsTotal: number
  conversationsActive24h: number
  conversationsActive7d: number
  pausedNow: number
  inbound24h: number
  outboundBot24h: number
  outboundOperator24h: number
  fileCount24h: number
  /** Number of conversation rows where the LINE Profile API call has
   *  never succeeded (display_name null) — useful for spotting LINE
   *  token issues. */
  missingProfiles: number
  /** Conversations where the most recent message was from the
   *  customer (user) and no bot/operator reply has happened yet,
   *  oldest such customer message > 30 min ago. */
  awaitingReply: { count: number; oldestAgeSec: number | null }
  /** Pauses that auto-resume in the next 5 minutes — operator might
   *  want to extend before agent retakes. */
  pausesExpiringSoon: number
  storage: {
    bytes: number
    files: number
    thresholdMb: number
    overThreshold: boolean
    pctOfThreshold: number     // 0..1+ (can exceed 1 once over)
    retentionDays: number | 'never'
  }
}

function count(rows: Array<{ n: number }>): number {
  return Number(rows[0]?.n ?? 0)
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function getCsStats(): CsStats {
  const now = nowSec()
  const ago24h = now - DAY
  const ago7d = now - 7 * DAY
  const ago30m = now - 1800
  const soonResume = now + 5 * 60

  const conversationsTotal = count(db.select({ n: sql<number>`COUNT(*)` }).from(csConversations).all())

  const conversationsActive24h = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csConversations).where(gt(csConversations.lastMessageAt, sql`${ago24h}`)).all(),
  )

  const conversationsActive7d = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csConversations).where(gt(csConversations.lastMessageAt, sql`${ago7d}`)).all(),
  )

  const pausedNow = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csAgentPause).where(gt(csAgentPause.resumeAt, sql`${now}`)).all(),
  )

  const pausesExpiringSoon = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csAgentPause)
      .where(and(gt(csAgentPause.resumeAt, sql`${now}`), sql`${csAgentPause.resumeAt} <= ${soonResume}`))
      .all(),
  )

  const inbound24h = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csMessages)
      .where(and(eq(csMessages.direction, 'user'), gt(csMessages.createdAt, sql`${ago24h}`))).all(),
  )
  const outboundBot24h = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csMessages)
      .where(and(eq(csMessages.direction, 'bot'), gt(csMessages.createdAt, sql`${ago24h}`))).all(),
  )
  const outboundOperator24h = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csMessages)
      .where(and(eq(csMessages.direction, 'operator'), gt(csMessages.createdAt, sql`${ago24h}`))).all(),
  )

  const fileCount24h = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csMessages)
      .where(and(sql`${csMessages.type} IN ('image','video','audio','file')`, gt(csMessages.createdAt, sql`${ago24h}`))).all(),
  )

  const missingProfiles = count(
    db.select({ n: sql<number>`COUNT(*)` }).from(csConversations).where(isNull(csConversations.displayName)).all(),
  )

  // Awaiting-reply: a conversation whose lastDirection='user' (latest message
  // came from the customer) and lastMessageAt > 30 min ago.
  const awaitingRows = db.select({
    age: sql<number>`${nowSec()} - ${csConversations.lastMessageAt}`,
  }).from(csConversations).where(and(eq(csConversations.lastDirection, 'user'), sql`${csConversations.lastMessageAt} < ${ago30m}`)).all() as Array<{ age: number }>
  const awaitingReplyCount = awaitingRows.length
  const oldestAgeSec = awaitingRows.length > 0
    ? Math.max(...awaitingRows.map(r => Number(r.age) || 0))
    : null

  const storageSettings = readStorageSettings()
  const storageStats = getStorageStats()
  const thresholdMb = storageSettings.warnThresholdMb
  const currentMb = storageStats.mediaBytes / 1024 / 1024
  const pctOfThreshold = thresholdMb > 0 ? currentMb / thresholdMb : 0

  return {
    conversationsTotal,
    conversationsActive24h,
    conversationsActive7d,
    pausedNow,
    inbound24h,
    outboundBot24h,
    outboundOperator24h,
    fileCount24h,
    missingProfiles,
    awaitingReply: { count: awaitingReplyCount, oldestAgeSec },
    pausesExpiringSoon,
    storage: {
      bytes: storageStats.mediaBytes,
      files: storageStats.mediaFiles,
      thresholdMb,
      overThreshold: currentMb >= thresholdMb,
      pctOfThreshold,
      retentionDays: storageSettings.retentionDays,
    },
  }
}

export type RecommendationSeverity = 'info' | 'warning' | 'attention'
export interface Recommendation {
  id: string
  severity: RecommendationSeverity
  text: string
  /** Optional translation key + values if the UI prefers an i18n string. */
  i18nKey?: string
  i18nValues?: Record<string, string | number>
}

/** Heuristic recommendations derived from the stats — surfaced on the
 *  Overview tab so operators don't have to inspect every number to know
 *  what (if anything) needs attention. */
export function getRecommendations(stats: CsStats): Recommendation[] {
  const out: Recommendation[] = []

  if (stats.awaitingReply.count > 0) {
    const ageMin = stats.awaitingReply.oldestAgeSec ? Math.floor(stats.awaitingReply.oldestAgeSec / 60) : 0
    out.push({
      id: 'awaiting-reply',
      severity: ageMin >= 120 ? 'attention' : 'warning',
      text: '',
      i18nKey: 'awaitingReply',
      i18nValues: { count: stats.awaitingReply.count, ageMin },
    })
  }

  if (stats.pausesExpiringSoon > 0) {
    out.push({
      id: 'pause-expiring',
      severity: 'info',
      text: '',
      i18nKey: 'pauseExpiring',
      i18nValues: { count: stats.pausesExpiringSoon },
    })
  }

  if (stats.storage.overThreshold) {
    out.push({
      id: 'storage-over',
      severity: 'warning',
      text: '',
      i18nKey: 'storageOver',
      i18nValues: {
        currentMb: Math.round(stats.storage.bytes / 1024 / 1024),
        thresholdMb: stats.storage.thresholdMb,
      },
    })
  } else if (stats.storage.pctOfThreshold >= 0.8) {
    out.push({
      id: 'storage-near',
      severity: 'info',
      text: '',
      i18nKey: 'storageNear',
      i18nValues: {
        pct: Math.round(stats.storage.pctOfThreshold * 100),
        thresholdMb: stats.storage.thresholdMb,
      },
    })
  }

  if (stats.missingProfiles > 0 && stats.conversationsTotal > 0) {
    const pct = (stats.missingProfiles / stats.conversationsTotal) * 100
    if (pct >= 30) {
      out.push({
        id: 'missing-profiles',
        severity: 'warning',
        text: '',
        i18nKey: 'missingProfiles',
        i18nValues: { count: stats.missingProfiles, total: stats.conversationsTotal },
      })
    }
  }

  if (stats.storage.retentionDays === 'never' && stats.storage.bytes > 500 * 1024 * 1024) {
    out.push({
      id: 'retention-never',
      severity: 'info',
      text: '',
      i18nKey: 'retentionNever',
      i18nValues: { gb: (stats.storage.bytes / 1024 / 1024 / 1024).toFixed(1) },
    })
  }

  if (out.length === 0 && stats.conversationsTotal > 0) {
    out.push({
      id: 'all-good',
      severity: 'info',
      text: '',
      i18nKey: 'allGood',
    })
  }

  return out
}
