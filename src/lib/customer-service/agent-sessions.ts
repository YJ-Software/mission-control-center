/**
 * Read openclaw agent session metadata + parse the per-session message
 * stream so the operator can inspect what the agent actually did
 * turn-by-turn for a given LINE customer.
 *
 * Data sources:
 *   ~/.openclaw/agents/<agentId>/sessions/sessions.json   — index keyed by
 *     `agent:<agentId>:line:direct:<lowercase userId>` with session metadata.
 *   ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl — chronological
 *     message stream (user/assistant/toolResult), already structured.
 *
 * We also cross-reference cs_messages so the UI can flag assistant text that
 * was generated but never made it to LINE (openclaw drop / mid-turn race).
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { db } from '@/lib/db'
import { csMessages } from '@/lib/schema'
import { and, eq, gte, lte } from 'drizzle-orm'

const OPENCLAW_AGENTS_DIR = join(homedir(), '.openclaw', 'agents')

export interface AgentSessionSummary {
  agentId: string
  sessionId: string
  startedAt: number | null    // unix sec
  updatedAt: number | null    // unix sec
  lastInteractionAt: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  exists: boolean             // false if session jsonl was already pruned
  /** Set when this session has at least one assistant text with no
   *  matching cs_messages bot row (potential drop). */
  hasUndelivered: boolean
}

export interface TimelineEvent {
  ts: number                  // unix ms
  kind:
    | 'user'
    | 'assistant_thinking'
    | 'assistant_text'
    | 'tool_call'
    | 'tool_result'
    | 'session_start'
    | 'session_end'
    | 'meta'
  text?: string
  toolName?: string
  toolArgs?: string           // JSON stringified, truncated
  isError?: boolean
  /** For assistant_text only: did we find a matching cs_messages bot row? */
  delivered?: boolean
  /** For assistant_text: model stop reason */
  stopReason?: string
}

const lcKey = (userId: string) => `line:direct:${userId.toLowerCase()}`

function listAgentDirs(): string[] {
  if (!existsSync(OPENCLAW_AGENTS_DIR)) return []
  return readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

function readSessionsIndex(agentId: string): Record<string, any> | null {
  const p = join(OPENCLAW_AGENTS_DIR, agentId, 'sessions', 'sessions.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** Drizzle DB query of bot-direction messages within [from, to] for a userId. */
function botMessagesInWindow(userId: string, fromSec: number, toSec: number): { text: string | null; createdAt: number | null }[] {
  return db.select({ text: csMessages.text, createdAt: csMessages.createdAt })
    .from(csMessages)
    .where(and(
      eq(csMessages.userId, userId),
      eq(csMessages.direction, 'bot'),
      gte(csMessages.createdAt, fromSec - 5),
      lte(csMessages.createdAt, toSec + 60),
    ))
    .all()
}

export function listAgentSessionsForUser(userId: string): AgentSessionSummary[] {
  const key = lcKey(userId)
  const out: AgentSessionSummary[] = []
  for (const agentId of listAgentDirs()) {
    const idx = readSessionsIndex(agentId)
    if (!idx) continue
    for (const [k, v] of Object.entries(idx)) {
      if (!k.endsWith(`:${key}`)) continue
      const entry = v as any
      const ids: string[] = Array.isArray(entry?.usageFamilySessionIds) && entry.usageFamilySessionIds.length > 0
        ? entry.usageFamilySessionIds
        : [entry?.sessionId].filter(Boolean) as string[]
      // De-dup so the most recent appears once even if it also surfaces in the index key
      const uniq = Array.from(new Set(ids))
      for (const sid of uniq) {
        const sessionFile = join(OPENCLAW_AGENTS_DIR, agentId, 'sessions', `${sid}.jsonl`)
        const exists = existsSync(sessionFile)
        const startedAt = sid === entry?.sessionId && typeof entry?.sessionStartedAt === 'number'
          ? Math.floor(entry.sessionStartedAt / 1000) : null
        const updatedAt = sid === entry?.sessionId && typeof entry?.updatedAt === 'number'
          ? Math.floor(entry.updatedAt / 1000) : null
        out.push({
          agentId,
          sessionId: sid,
          startedAt,
          updatedAt,
          lastInteractionAt: sid === entry?.sessionId && typeof entry?.lastInteractionAt === 'number'
            ? Math.floor(entry.lastInteractionAt / 1000) : null,
          totalTokens: typeof entry?.totalTokens === 'number' && sid === entry.sessionId ? entry.totalTokens : null,
          estimatedCostUsd: typeof entry?.estimatedCostUsd === 'number' && sid === entry.sessionId ? entry.estimatedCostUsd : null,
          exists,
          hasUndelivered: false,   // filled in by getAgentSessionTimeline when fetched
        })
      }
    }
  }
  // Newest first by updatedAt (fallback to mtime via summary missing data)
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/** Truncate so the timeline JSON doesn't balloon when the UI fetches many turns. */
function trunc(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + `… [+${s.length - n}]`
}

export interface AgentSessionTimeline {
  agentId: string
  sessionId: string
  events: TimelineEvent[]
  hasUndelivered: boolean
}

export function getAgentSessionTimeline(
  agentId: string,
  sessionId: string,
  userId: string,
): AgentSessionTimeline | null {
  const sessionFile = join(OPENCLAW_AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(sessionFile)) return null

  const raw = readFileSync(sessionFile, 'utf-8')
  const lines = raw.split('\n').filter(l => l.trim().length > 0)
  const events: TimelineEvent[] = []
  let firstTs = Number.POSITIVE_INFINITY
  let lastTs = 0

  for (const line of lines) {
    let obj: any
    try { obj = JSON.parse(line) } catch { continue }

    const ts = typeof obj.timestamp === 'string'
      ? Date.parse(obj.timestamp)
      : (typeof obj.timestamp === 'number' ? obj.timestamp : 0)
    if (ts > 0) {
      firstTs = Math.min(firstTs, ts)
      lastTs = Math.max(lastTs, ts)
    }

    if (obj.type === 'session') {
      events.push({ ts, kind: 'session_start', text: `session ${sessionId.slice(0, 8)} • cwd=${obj.cwd ?? '?'}` })
      continue
    }

    if (obj.type === 'message' && obj.message?.role === 'user') {
      const content = obj.message.content
      const text = Array.isArray(content)
        ? content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')
        : (typeof content === 'string' ? content : '')
      // The openclaw runtime wraps inbound LINE text with a metadata
      // preamble. Strip it so the operator sees what the customer actually
      // said.
      const clean = text.replace(/^Conversation info[\s\S]*?```\s*\n\s*Sender[\s\S]*?```\s*\n+/, '')
      events.push({ ts, kind: 'user', text: trunc(clean.trim(), 800) })
      continue
    }

    if (obj.type === 'message' && obj.message?.role === 'assistant') {
      const content = Array.isArray(obj.message.content) ? obj.message.content : []
      for (const piece of content) {
        if (piece.type === 'thinking') {
          events.push({ ts, kind: 'assistant_thinking', text: trunc(piece.thinking ?? '', 600) })
        } else if (piece.type === 'text') {
          events.push({
            ts,
            kind: 'assistant_text',
            text: piece.text ?? '',
            stopReason: obj.message.stopReason ?? undefined,
          })
        } else if (piece.type === 'toolCall') {
          let argsStr = ''
          try { argsStr = JSON.stringify(piece.arguments ?? {}) } catch { argsStr = String(piece.partialArgs ?? '') }
          events.push({ ts, kind: 'tool_call', toolName: piece.name ?? '?', toolArgs: trunc(argsStr, 240) })
        }
      }
      continue
    }

    if (obj.type === 'message' && obj.message?.role === 'toolResult') {
      const content = obj.message.content
      const text = Array.isArray(content)
        ? content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')
        : (typeof content === 'string' ? content : '')
      events.push({
        ts,
        kind: 'tool_result',
        toolName: obj.message.toolName ?? '?',
        text: trunc(text, 400),
        isError: !!obj.message.isError,
      })
      continue
    }
  }

  // Cross-reference assistant_text events with cs_messages bot rows to
  // mark undelivered ones. We use a generous time window (±60s) and a
  // best-effort prefix match (first 30 chars of stripped text) so minor
  // formatting differences don't trigger false "undelivered" flags.
  const fromSec = Math.floor(firstTs / 1000)
  const toSec = Math.ceil(lastTs / 1000)
  const botRows = botMessagesInWindow(userId, fromSec, toSec)
  let hasUndelivered = false
  for (const ev of events) {
    if (ev.kind !== 'assistant_text' || !ev.text) continue
    const head = ev.text.trim().slice(0, 30)
    const match = botRows.find(r => (r.text ?? '').trim().startsWith(head))
    ev.delivered = !!match
    if (!match) hasUndelivered = true
  }

  return { agentId, sessionId, events, hasUndelivered }
}
