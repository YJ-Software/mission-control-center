import { NextRequest, NextResponse } from 'next/server'
import {
  parseJournalJson,
  hasDirectSystemJournalAccess,
  canSudoJournal,
  runJournalctl,
  clampLimit,
  sortDescLimit,
  type LogEntry,
  type LogResult,
} from '@/lib/logs/journal'

export const dynamic = 'force-dynamic'

// OpenClaw ships as these systemd units; it may run user-scoped (our default
// install) or system-scoped (some customer boxes), so we read both.
const OPENCLAW_UNITS = ['openclaw-gateway', 'openclaw-webhooks', 'openclaw']

function unitArgs(limit: number): string[] {
  const args = ['--no-pager', '-o', 'json', '-n', String(limit)]
  for (const u of OPENCLAW_UNITS) args.push('-u', `${u}.service`)
  return args
}

/**
 * OpenClaw log viewer — journald for the OpenClaw units. The `service` column
 * is derived from the `[subsystem]` tag in each line (ws / cron / agent / …)
 * so the filter is useful even though every row comes from one unit.
 */
export async function GET(req: NextRequest) {
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'))

  try {
    const merged: LogEntry[] = []

    // User-scoped units (default install).
    const userOut = runJournalctl(['--user', ...unitArgs(limit)])
    merged.push(...parseJournalJson(userOut, { idPrefix: 'ocu', serviceFrom: 'tag' }))

    // System-scoped units (customer boxes) — only if we have access.
    let sysOut = ''
    if (hasDirectSystemJournalAccess()) sysOut = runJournalctl(['--system', ...unitArgs(limit)])
    else if (canSudoJournal()) sysOut = runJournalctl(['--system', ...unitArgs(limit)], true)
    if (sysOut) merged.push(...parseJournalJson(sysOut, { idPrefix: 'ocs', serviceFrom: 'tag' }))

    const logs = sortDescLimit(merged, limit)
    const result: LogResult = { logs, limited: false }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { logs: [], limited: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
