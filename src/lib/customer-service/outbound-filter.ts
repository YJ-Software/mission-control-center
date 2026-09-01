import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { csOutboundFilterHits, settings } from '@/lib/schema'
import { desc, eq, lt, sql } from 'drizzle-orm'

/**
 * Outbound reply filter.
 *
 * OpenClaw's delivery path exposes `message_sending`, which can rewrite or
 * cancel a reply before it reaches the customer. Before wiring that up we
 * run in **shadow mode**: every bot reply the business-hours-gate plugin
 * already mirrors into `/api/customer-service/cs-event` is evaluated here
 * and, when a rule matches, the verdict is logged. Nothing is altered and
 * nothing is blocked — the point is to find out what actually leaks, and
 * to prove the rules don't eat real answers, before we let them.
 *
 * Because the evaluation piggybacks on the existing cs-event mirror (which
 * the plugin already fires and forgets), shadow mode adds no latency to the
 * send path and needs no plugin change or gateway restart.
 */

export type FilterMode = 'off' | 'shadow' | 'enforce'
export type FilterAction = 'block' | 'strip'
export type FilterOutcome = 'allow' | 'rewrite' | 'block'

export const MODE_KEY = 'customer-service.outboundFilter.mode'
const DEFAULT_MODE: FilterMode = 'shadow'

/** Rows older than this are dropped on write — shadow logs keep full reply text. */
const RETENTION_DAYS = 30

export interface FilterRule {
  id: string
  /** Human label shown in the dashboard. */
  label: string
  /** `block` suppresses the whole reply; `strip` removes just the match. */
  action: FilterAction
  pattern: RegExp
}

/**
 * Seed rules, derived from leaks we have actually seen reach LINE customers
 * (model-fallback banners, reasoning residue, tool/provider errors) plus the
 * internal identifiers a customer should never be shown.
 *
 * Patterns are deliberately narrow. A shadow rule that never fires costs
 * nothing; one that matches ordinary Chinese prose would poison the sample
 * we are collecting.
 */
export const DEFAULT_RULES: FilterRule[] = [
  {
    id: 'model-fallback',
    label: 'Model fallback banner',
    action: 'strip',
    pattern: /^.*(?:model fallback|模型(?:回退|降級|切換)|falling back to|fallback model|unavailable[^\n]*falling back).*$\r?\n?/gim,
  },
  {
    id: 'reasoning-tag',
    label: 'Reasoning tag leak',
    action: 'strip',
    pattern: /<(thinking|think|reasoning|antml:thinking)>[\s\S]*?(?:<\/\1>|$)/gi,
  },
  {
    id: 'stack-trace',
    label: 'Stack trace',
    action: 'block',
    pattern: /(?:^|\n)\s*at\s+\S+\s*\([^)]*:\d+:\d+\)|(?:^|\n)(?:Type|Range|Reference|Syntax|Eval|URI)?Error:\s/g,
  },
  {
    id: 'tool-error',
    label: 'Tool / shell error',
    action: 'block',
    pattern: /\b(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|command not found|no such file or directory|permission denied|tool (?:call )?(?:failed|error)|exited with code \d+)\b|^⚠️?\s*🛠️?.*$/gim,
  },
  {
    id: 'provider-error',
    label: 'Model provider error',
    action: 'block',
    pattern: /\b(?:rate[_ ]?limit(?:ed|_error)?|overloaded_error|insufficient_quota|context (?:window |length )?exceeded|invalid[_ ]api[_ ]key|authentication_error|upstream (?:error|timeout))\b/gi,
  },
  {
    // The single most common leak in production: four occurrences across
    // 2026-07/08, every one delivered verbatim to a customer.
    id: 'llm-request-failed',
    label: 'LLM request failure',
    action: 'block',
    pattern: /\bLLM request failed\b|\bprovider rejected the request\b|\brequest failed:\s*provider\b/gi,
  },
  {
    // The model narrating its own tooling instead of answering. English-only
    // by nature — the agent replies to customers in Chinese, so these cannot
    // collide with a real answer.
    id: 'model-meta',
    label: 'Model narrating its own tools',
    action: 'block',
    pattern: /\bBased on the tools available to me\b|\bI (?:can(?:'|’)?t|cannot|do(?:n(?:'|’)?t| not) have|am unable to) (?:use|access|run|execute)\b[^\n]{0,60}?\b(?:tool|exec|shell|command)\b|\bthe `?\w+`? tool (?:returned|failed|is not available)\b/gi,
  },
  {
    id: 'internal-path',
    label: 'Internal path leak',
    action: 'block',
    pattern: /(?:\/home\/[\w.-]+|\/root|~?\/\.openclaw|\/var\/log)\/[\w./-]*/g,
  },
  {
    id: 'media-placeholder',
    label: 'Unrendered media placeholder',
    action: 'strip',
    pattern: /<media:[a-z]+>/gi,
  },
  {
    // Same reasoning as internal-path: a reply that names the runtime is a
    // status banner or an error, not an answer with a bad word in it. The
    // agent sells office space; it has no legitimate reason to say "openclaw".
    id: 'runtime-mention',
    label: 'Runtime / session identifier leak',
    action: 'block',
    pattern: /\b(?:openclaw|mission[- ]control|gateway (?:restart|session)|sessionKey|session_key)\b[^\n]{0,40}/gi,
  },
]

export interface RuleMatch {
  ruleId: string
  label: string
  action: FilterAction
  /** First matched span, truncated — enough to judge the rule without the full reply. */
  sample: string
}

export interface FilterVerdict {
  outcome: FilterOutcome
  matched: RuleMatch[]
  /** The reply an enforcing filter would send. Null when it would send nothing. */
  proposedText: string | null
}

/**
 * Evaluate one outbound reply. Pure — no I/O, no mutation of `rules`.
 *
 * Rule regexes are global and therefore stateful, so each evaluation gets a
 * fresh clone; sharing `lastIndex` across calls would make results depend on
 * whatever was tested previously.
 */
export function evaluateOutbound(text: string, rules: FilterRule[] = DEFAULT_RULES): FilterVerdict {
  if (!text || !text.trim()) return { outcome: 'allow', matched: [], proposedText: null }

  const matched: RuleMatch[] = []
  let blocked = false
  let working = text

  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    const hits = text.match(re)
    if (!hits || hits.length === 0) continue

    matched.push({
      ruleId: rule.id,
      label: rule.label,
      action: rule.action,
      sample: hits[0].trim().slice(0, 200),
    })

    if (rule.action === 'block') {
      blocked = true
      continue
    }
    working = working.replace(new RegExp(rule.pattern.source, rule.pattern.flags), '')
  }

  if (matched.length === 0) return { outcome: 'allow', matched: [], proposedText: null }
  if (blocked) return { outcome: 'block', matched, proposedText: null }

  // Collapse the holes stripping left behind. If nothing survives, there is
  // no reply to send — that is a block, not an empty message.
  const cleaned = working.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) return { outcome: 'block', matched, proposedText: null }
  return { outcome: 'rewrite', matched, proposedText: cleaned }
}

// --- mode ---

export function getFilterMode(): FilterMode {
  const raw = db.select().from(settings).where(eq(settings.key, MODE_KEY)).get()?.value
  return raw === 'off' || raw === 'shadow' || raw === 'enforce' ? raw : DEFAULT_MODE
}

export function setFilterMode(mode: FilterMode): void {
  db.insert(settings)
    .values({ key: MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: settings.key, set: { value: mode } })
    .run()
}

// --- hit log ---

export interface FilterHitRow {
  id: string
  userId: string
  channelId: string | null
  mode: string
  outcome: string
  ruleIds: string
  matches: string
  originalText: string
  proposedText: string | null
  createdAt: number | null
}

export interface RecordHitInput {
  userId: string
  channelId?: string | null
  mode: FilterMode
  verdict: FilterVerdict
  originalText: string
}

export function recordFilterHit(input: RecordHitInput): FilterHitRow {
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const row = {
    id,
    userId: input.userId,
    channelId: input.channelId ?? null,
    mode: input.mode,
    outcome: input.verdict.outcome,
    ruleIds: JSON.stringify(input.verdict.matched.map(m => m.ruleId)),
    matches: JSON.stringify(input.verdict.matched),
    originalText: input.originalText,
    proposedText: input.verdict.proposedText,
  }
  db.insert(csOutboundFilterHits).values(row).run()

  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60
  db.delete(csOutboundFilterHits).where(lt(csOutboundFilterHits.createdAt, sql`${cutoff}`)).run()

  return { ...row, createdAt: now }
}

/**
 * Shadow-mode entry point: evaluate a bot reply and log it if any rule fired.
 * Returns the verdict so callers can surface it; in shadow mode nobody acts
 * on it. Never throws — a filter bug must not break the message mirror.
 */
export function inspectOutbound(input: { userId: string; text: string; channelId?: string | null }): FilterVerdict | null {
  try {
    const mode = getFilterMode()
    if (mode === 'off') return null
    const verdict = evaluateOutbound(input.text)
    if (verdict.outcome === 'allow') return verdict
    recordFilterHit({
      userId: input.userId,
      channelId: input.channelId ?? null,
      mode,
      verdict,
      originalText: input.text,
    })
    return verdict
  } catch (err) {
    console.warn('[outbound-filter] inspect failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export function listFilterHits(opts: { limit?: number } = {}): FilterHitRow[] {
  return db.select().from(csOutboundFilterHits)
    .orderBy(desc(csOutboundFilterHits.createdAt))
    .limit(opts.limit ?? 50)
    .all() as FilterHitRow[]
}

export interface FilterStats {
  total: number
  last24h: number
  byRule: Array<{ ruleId: string; label: string; count: number }>
  byOutcome: Record<FilterOutcome, number>
}

export function getFilterStats(): FilterStats {
  const rows = db.select().from(csOutboundFilterHits).all() as FilterHitRow[]
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60
  const labels = new Map(DEFAULT_RULES.map(r => [r.id, r.label]))
  const counts = new Map<string, number>()
  const byOutcome: Record<FilterOutcome, number> = { allow: 0, rewrite: 0, block: 0 }

  for (const row of rows) {
    if (row.outcome in byOutcome) byOutcome[row.outcome as FilterOutcome]++
    let ids: string[] = []
    try {
      ids = JSON.parse(row.ruleIds) as string[]
    } catch { /* malformed row — skip its rule tally, still counted in total */ }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return {
    total: rows.length,
    last24h: rows.filter(r => (r.createdAt ?? 0) >= dayAgo).length,
    byRule: [...counts.entries()]
      .map(([ruleId, count]) => ({ ruleId, label: labels.get(ruleId) ?? ruleId, count }))
      .sort((a, b) => b.count - a.count),
    byOutcome,
  }
}

export function clearFilterHits(): number {
  const res = db.delete(csOutboundFilterHits).run()
  return res.changes ?? 0
}
