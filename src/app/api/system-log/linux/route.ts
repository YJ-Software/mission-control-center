import { NextRequest, NextResponse } from 'next/server'
import {
  parseJournalJson,
  hasDirectSystemJournalAccess,
  canSudoJournal,
  runJournalctl,
  clampLimit,
  sortDescLimit,
  type LogResult,
} from '@/lib/logs/journal'

export const dynamic = 'force-dynamic'

/**
 * Linux system journal viewer.
 *
 * The dashboard user can read the full system journal only if it belongs to
 * the `systemd-journal` / `adm` group, or has passwordless sudo. We try those
 * in order and otherwise fall back to the user-scoped journal, flagging the
 * result as `limited` so the UI can show how to grant access.
 */
export async function GET(req: NextRequest) {
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'))

  try {
    const baseArgs = ['--no-pager', '-o', 'json', '-n', String(limit)]
    let stdout = ''
    let limited = false
    let hint: string | undefined

    if (hasDirectSystemJournalAccess()) {
      stdout = runJournalctl(['--system', ...baseArgs])
    } else if (canSudoJournal()) {
      stdout = runJournalctl(['--system', ...baseArgs], true)
    } else {
      // No system access — show what this user can see and explain how to fix.
      stdout = runJournalctl(baseArgs)
      limited = true
      hint =
        'Only this user’s journal is visible. Add the dashboard user to the ' +
        '`systemd-journal` group (sudo usermod -aG systemd-journal <user>) and ' +
        'restart the service to see full system logs.'
    }

    const logs = sortDescLimit(parseJournalJson(stdout, { idPrefix: 'sys' }), limit)
    const result: LogResult = { logs, limited, hint }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { logs: [], limited: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
