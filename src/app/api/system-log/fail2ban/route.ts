import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import {
  parseJournalJson,
  parseFail2banFile,
  classifyFail2ban,
  hasDirectSystemJournalAccess,
  canSudoJournal,
  runJournalctl,
  readLogFile,
  clampLimit,
  sortDescLimit,
  type LogEntry,
  type LogResult,
} from '@/lib/logs/journal'

export const dynamic = 'force-dynamic'

const FAIL2BAN_LOG = '/var/log/fail2ban.log'

function fail2banInstalled(): boolean {
  if (existsSync(FAIL2BAN_LOG)) return true
  try {
    execFileSync('which', ['fail2ban-client'], { stdio: 'ignore', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * fail2ban log viewer. On Debian/Ubuntu fail2ban logs ban/unban activity to
 * `/var/log/fail2ban.log` (not journald), so we read the file (via sudo if
 * needed) AND the `fail2ban.service` journal (startup/errors) and merge.
 * The `service` column is the jail name (sshd / mission-control / …).
 */
export async function GET(req: NextRequest) {
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'))

  try {
    if (!fail2banInstalled()) {
      const result: LogResult = {
        logs: [],
        limited: true,
        hint: 'fail2ban is not installed on this host. See deploy/fail2ban/README.md to enable the Mission Control jail.',
      }
      return NextResponse.json(result)
    }

    const merged: LogEntry[] = []

    // Ban/unban activity from the log file.
    const fileContent = readLogFile(FAIL2BAN_LOG, Math.min(limit * 2, 2000))
    if (fileContent) merged.push(...parseFail2banFile(fileContent, 'f2bf'))

    // Service-level events from journald (with the same jail/keyword treatment).
    let jrnl = ''
    const jargs = ['--no-pager', '-o', 'json', '-n', String(limit), '-u', 'fail2ban.service']
    if (hasDirectSystemJournalAccess()) jrnl = runJournalctl(['--system', ...jargs])
    else if (canSudoJournal()) jrnl = runJournalctl(['--system', ...jargs], true)
    if (jrnl) {
      merged.push(...parseJournalJson(jrnl, {
        idPrefix: 'f2bj',
        serviceFrom: 'tag',
        tagFallback: 'fail2ban',
        classifyLevel: classifyFail2ban,
      }))
    }

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
