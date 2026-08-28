import { NextRequest, NextResponse } from 'next/server'
import {
  DEFAULT_RULES,
  clearFilterHits,
  evaluateOutbound,
  getFilterMode,
  getFilterStats,
  listFilterHits,
  setFilterMode,
  type FilterMode,
} from '@/lib/customer-service/outbound-filter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 'enforce' is a valid stored value but not yet settable: enforcing needs the
// plugin's message_sending hook to *await* a verdict, which shadow mode
// deliberately does not do. Offering the toggle before that lands would look
// like filtering is on while replies still go out untouched.
const SETTABLE_MODES: FilterMode[] = ['off', 'shadow']

/** Dashboard read: current mode, the rule set, recent hits and the tallies. */
export async function GET(req: NextRequest) {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50)
  const hits = listFilterHits({ limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50 })
  return NextResponse.json({
    mode: getFilterMode(),
    rules: DEFAULT_RULES.map(r => ({ id: r.id, label: r.label, action: r.action, pattern: r.pattern.source })),
    stats: getFilterStats(),
    hits: hits.map(h => ({
      ...h,
      matches: safeParse(h.matches),
      ruleIds: safeParse(h.ruleIds),
    })),
  })
}

/**
 * Dry-run a reply against the rule set without recording anything. Used by
 * the dashboard to test a rule change, and reserved for the plugin's
 * message_sending hook once we move from shadow to enforce.
 */
export async function POST(req: NextRequest) {
  let body: { text?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }
  return NextResponse.json({ mode: getFilterMode(), ...evaluateOutbound(body.text) })
}

export async function PUT(req: NextRequest) {
  let body: { mode?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!SETTABLE_MODES.includes(body.mode as FilterMode)) {
    return NextResponse.json({ error: `mode must be one of ${SETTABLE_MODES.join(', ')}` }, { status: 400 })
  }
  setFilterMode(body.mode as FilterMode)
  return NextResponse.json({ ok: true, mode: getFilterMode() })
}

export async function DELETE() {
  return NextResponse.json({ ok: true, cleared: clearFilterHits() })
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
