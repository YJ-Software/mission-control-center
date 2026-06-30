import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

/**
 * Shared helpers for the /system-log viewers (Linux system journal +
 * OpenClaw). We read journald via `journalctl -o json` (one JSON object per
 * line) and normalise into the LogEntry shape the UI renders.
 */

export type LogLevel = 'info' | 'warning' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  service: string
  message: string
}

export interface LogResult {
  logs: LogEntry[]
  /** true when we could not read the full system journal (limited to own user) */
  limited: boolean
  /** how to grant full access, shown in the UI when limited */
  hint?: string
}

/** journald PRIORITY (syslog severity): 0-3 ≈ error, 4 ≈ warning, ≥5 info. */
export function levelFromPriority(priority: string | undefined): LogLevel {
  const p = Number(priority)
  if (Number.isFinite(p)) {
    if (p <= 3) return 'error'
    if (p === 4) return 'warning'
    return 'info'
  }
  return 'info'
}

/** MESSAGE can be a string or an array of byte values (binary). Coerce safely. */
function coerceMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    try {
      return Buffer.from(raw as number[]).toString('utf8')
    } catch {
      return ''
    }
  }
  return ''
}

/** Strip a leading ISO-8601 timestamp the app may have already prefixed. */
function stripLeadingTimestamp(msg: string): string {
  return msg.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:?\d{2}|Z)?\s+/, '')
}

export interface ParseOpts {
  idPrefix: string
  /**
   * Derive the `service` column. Default: systemd unit (user unit preferred),
   * falling back to SYSLOG_IDENTIFIER. For OpenClaw / fail2ban we override this
   * to pull the first `[subsystem]` tag out of the message (skipping a numeric
   * PID bracket) so the filter is meaningful.
   */
  serviceFrom?: 'unit' | 'tag'
  /** service value when serviceFrom='tag' finds no tag */
  tagFallback?: string
  /** override level detection (default: from journald PRIORITY) */
  classifyLevel?: (message: string) => LogLevel
}

/** First `[token]` that isn't a pure-numeric PID, e.g. `[sshd]`, `[ws]`. */
function extractTag(msg: string): string | null {
  for (const m of msg.matchAll(/\[([a-z0-9_.-]{1,32})\]/gi)) {
    if (!/^\d+$/.test(m[1])) return m[1]
  }
  return null
}

interface JournalRecord {
  __REALTIME_TIMESTAMP?: string
  PRIORITY?: string
  _SYSTEMD_UNIT?: string
  _SYSTEMD_USER_UNIT?: string
  SYSLOG_IDENTIFIER?: string
  MESSAGE?: unknown
}

export function parseJournalJson(stdout: string, opts: ParseOpts): LogEntry[] {
  const entries: LogEntry[] = []
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let rec: JournalRecord
    try {
      rec = JSON.parse(line) as JournalRecord
    } catch {
      continue
    }

    const usec = Number(rec.__REALTIME_TIMESTAMP)
    const ts = Number.isFinite(usec) ? new Date(usec / 1000) : new Date()

    let message = coerceMessage(rec.MESSAGE)
    let service: string

    if (opts.serviceFrom === 'tag') {
      // OpenClaw lines look like: "<iso> [ws] ⇄ res ✓ cron.list 50ms …"
      message = stripLeadingTimestamp(message)
      service = extractTag(message) ?? opts.tagFallback ?? 'log'
    } else {
      const unit = (rec._SYSTEMD_USER_UNIT || rec._SYSTEMD_UNIT || '').replace(/\.service$/, '')
      service = unit || rec.SYSLOG_IDENTIFIER || 'system'
    }

    if (!message) continue

    entries.push({
      id: `${opts.idPrefix}-${i}`,
      timestamp: ts.toISOString(),
      level: opts.classifyLevel ? opts.classifyLevel(message) : levelFromPriority(rec.PRIORITY),
      service,
      message,
    })
  }
  return entries
}

/** Does the current process already belong to a journal-reading group? */
export function hasDirectSystemJournalAccess(): boolean {
  try {
    const want = new Set<number>()
    const groups = readFileSync('/etc/group', 'utf8')
    for (const row of groups.split('\n')) {
      const [name, , gid] = row.split(':')
      if (name === 'adm' || name === 'systemd-journal') {
        const n = Number(gid)
        if (Number.isFinite(n)) want.add(n)
      }
    }
    const mine = new Set<number>(process.getgroups?.() ?? [])
    for (const g of want) if (mine.has(g)) return true
  } catch {
    /* ignore */
  }
  return false
}

/** Can we run `sudo -n journalctl` without a password prompt? */
export function canSudoJournal(): boolean {
  try {
    execFileSync('sudo', ['-n', 'journalctl', '--system', '-n', '0'], {
      stdio: 'ignore',
      timeout: 4000,
    })
    return true
  } catch {
    return false
  }
}

/** Run journalctl and return raw stdout, or '' on failure. */
export function runJournalctl(args: string[], useSudo = false): string {
  try {
    const cmd = useSudo ? 'sudo' : 'journalctl'
    const finalArgs = useSudo ? ['-n', 'journalctl', ...args] : args
    return execFileSync(cmd, finalArgs, { encoding: 'utf8', timeout: 8000, maxBuffer: 32 * 1024 * 1024 })
  } catch {
    return ''
  }
}

/**
 * Classify a fail2ban line. fail2ban logs Ban/Unban/Found at NOTICE, so we
 * key off the action words instead of priority: Ban/Error stand out.
 */
export function classifyFail2ban(message: string): LogLevel {
  if (/\b(ERROR|CRITICAL)\b/i.test(message)) return 'error'
  if (/\b(WARNING|Ban)\b/.test(message)) return 'warning'
  return 'info'
}

/**
 * Parse `/var/log/fail2ban.log` lines. Format:
 *   2026-06-30 11:00:00,123 fail2ban.actions  [12345]: NOTICE  [sshd] Ban 1.2.3.4
 */
export function parseFail2banFile(content: string, idPrefix: string): LogEntry[] {
  const entries: LogEntry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{1,3})\s+(.*)$/)
    if (!m) continue
    const [, dateStr, ms, rest] = m
    const ts = new Date(`${dateStr.replace(' ', 'T')}.${ms.padEnd(3, '0')}`)
    // Drop the "fail2ban.component [pid]:" prefix for a cleaner message.
    const message = rest.replace(/^\S+\s+\[\d+\]:\s*/, '').trim() || rest
    entries.push({
      id: `${idPrefix}-${i}`,
      timestamp: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
      level: classifyFail2ban(message),
      service: extractTag(message) ?? 'fail2ban',
      message,
    })
  }
  return entries
}

/** Read the tail of a root-owned log file via passwordless sudo (or directly). */
export function readLogFile(path: string, lines = 500): string {
  try {
    return execFileSync('tail', ['-n', String(lines), path], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 })
  } catch {
    try {
      return execFileSync('sudo', ['-n', 'tail', '-n', String(lines), path], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 })
    } catch {
      return ''
    }
  }
}

export function clampLimit(raw: string | null, fallback = 300, max = 2000): number {
  const n = parseInt(raw || String(fallback), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

export function sortDescLimit(logs: LogEntry[], limit: number): LogEntry[] {
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return logs.slice(0, limit)
}
