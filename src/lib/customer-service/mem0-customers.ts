/**
 * Discover LINE customer userIds the operator might want to inspect.
 *
 * Two sources, merged + de-duped:
 *   1. Session trajectories under ~/.openclaw/agents/<agent-id>/sessions/.
 *      The agent id is auto-detected from openclaw.json `bindings` (the agent
 *      bound to channel=line, falling back to scanning every agent dir).
 *   2. mem0 telemetry jsonl ~/.openclaw/mem0-telemetry.jsonl
 *      (catches users who have memories but the session has rotated)
 *
 * No hardcoded agent ids — works on any deployment regardless of what the
 * customer-service agent was named.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const AGENTS_DIR = join(homedir(), '.openclaw', 'agents')
const TELEMETRY_PATH = join(homedir(), '.openclaw', 'mem0-telemetry.jsonl')

function discoverLineAgentIds(): string[] {
  // Pull from openclaw.json bindings first.
  const ids = new Set<string>()
  if (existsSync(OPENCLAW_CONFIG)) {
    try {
      const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
      const bindings: any[] = Array.isArray(cfg?.bindings) ? cfg.bindings : []
      for (const b of bindings) {
        if (b?.match?.channel === 'line' && typeof b?.agentId === 'string') {
          ids.add(b.agentId)
        }
      }
    } catch {
      /* ignore */
    }
  }
  // Fallback: scan every agent dir that has a sessions/ folder.
  if (ids.size === 0 && existsSync(AGENTS_DIR)) {
    try {
      for (const entry of readdirSync(AGENTS_DIR)) {
        const candidate = join(AGENTS_DIR, entry, 'sessions')
        if (existsSync(candidate)) ids.add(entry)
      }
    } catch {
      /* ignore */
    }
  }
  return [...ids]
}

export interface Customer {
  userId: string
  lastSeen: string | null
  sessionKey: string | null
  source: ('session' | 'memory')[]
  memoryCount?: number
}

const SESSION_KEY_RE = /^agent:[^:]+:line:direct:(.+)$/

function parseTrajectoryFirstLine(path: string): { sessionKey?: string } | null {
  try {
    const data = readFileSync(path, 'utf-8')
    const firstLine = data.slice(0, data.indexOf('\n'))
    if (!firstLine) return null
    const obj = JSON.parse(firstLine)
    return { sessionKey: typeof obj?.sessionKey === 'string' ? obj.sessionKey : undefined }
  } catch {
    return null
  }
}

function fromSessions(): Customer[] {
  const map = new Map<string, Customer>()
  for (const agentId of discoverLineAgentIds()) {
    const sessionsDir = join(AGENTS_DIR, agentId, 'sessions')
    if (!existsSync(sessionsDir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(sessionsDir)
    } catch {
      continue
    }

    for (const f of entries) {
      if (!f.endsWith('.trajectory.jsonl')) continue
      const path = join(sessionsDir, f)
      const meta = parseTrajectoryFirstLine(path)
      if (!meta?.sessionKey) continue
      const m = SESSION_KEY_RE.exec(meta.sessionKey)
      if (!m) continue
      const userId = m[1]

      let mtime: Date | null = null
      try {
        mtime = statSync(path).mtime
      } catch {
        mtime = null
      }

      const existing = map.get(userId)
      if (!existing) {
        map.set(userId, {
          userId,
          lastSeen: mtime?.toISOString() ?? null,
          sessionKey: meta.sessionKey,
          source: ['session'],
        })
      } else {
        const prev = existing.lastSeen ? Date.parse(existing.lastSeen) : 0
        const cur = mtime ? mtime.getTime() : 0
        if (cur > prev) {
          existing.lastSeen = mtime?.toISOString() ?? existing.lastSeen
          existing.sessionKey = meta.sessionKey
        }
      }
    }
  }
  return [...map.values()]
}

function fromTelemetry(): Map<string, { lastSeen: string | null; count: number }> {
  const out = new Map<string, { lastSeen: string | null; count: number }>()
  if (!existsSync(TELEMETRY_PATH)) return out
  const raw = readFileSync(TELEMETRY_PATH, 'utf-8')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as { ts?: string; user_id?: string; action?: string }
      if (!ev.user_id) continue
      const cur = out.get(ev.user_id) ?? { lastSeen: null, count: 0 }
      cur.count += ev.action === 'add' ? 1 : 0
      const evTs = ev.ts ?? null
      if (!cur.lastSeen || (evTs && evTs > cur.lastSeen)) cur.lastSeen = evTs
      out.set(ev.user_id, cur)
    } catch {
      /* skip */
    }
  }
  return out
}

// LINE userIds are canonically `U` + 32 hex chars. Session keys lowercase
// them, but the LINE Messaging API and our mem0 telemetry preserve the
// uppercase prefix. Normalize so the picker doesn't show duplicates.
function canonicalLineUid(raw: string): string {
  if (/^[uU][0-9a-f]{32}$/.test(raw)) return 'U' + raw.slice(1).toLowerCase()
  return raw
}

export function listCustomers(): Customer[] {
  const sessions = fromSessions().map((c) => ({ ...c, userId: canonicalLineUid(c.userId) }))
  const telemetry = fromTelemetry()

  const map = new Map<string, Customer>()
  for (const c of sessions) {
    const existing = map.get(c.userId)
    if (!existing) {
      map.set(c.userId, c)
    } else {
      const prev = existing.lastSeen ? Date.parse(existing.lastSeen) : 0
      const cur = c.lastSeen ? Date.parse(c.lastSeen) : 0
      if (cur > prev) {
        existing.lastSeen = c.lastSeen
        existing.sessionKey = c.sessionKey
      }
    }
  }

  for (const [rawUid, t] of telemetry) {
    const uid = canonicalLineUid(rawUid)
    const existing = map.get(uid)
    if (existing) {
      existing.memoryCount = t.count
      if (!existing.source.includes('memory')) existing.source.push('memory')
      const prev = existing.lastSeen ? Date.parse(existing.lastSeen) : 0
      const cur = t.lastSeen ? Date.parse(t.lastSeen) : 0
      if (cur > prev) existing.lastSeen = t.lastSeen
    } else {
      map.set(uid, {
        userId: uid,
        lastSeen: t.lastSeen,
        sessionKey: null,
        source: ['memory'],
        memoryCount: t.count,
      })
    }
  }

  return [...map.values()].sort((a, b) => {
    const aTs = a.lastSeen ? Date.parse(a.lastSeen) : 0
    const bTs = b.lastSeen ? Date.parse(b.lastSeen) : 0
    return bTs - aTs
  })
}
