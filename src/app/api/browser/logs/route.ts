import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getUnitNames } from '@/lib/headless-vnc'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error'
  service: string
  message: string
}

const JOURNAL_UNITS = getUnitNames('chrome').map(unit => ({
  unit,
  label: unit.replace('.service', ''),
}))

function classifyLevel(msg: string): 'info' | 'warning' | 'error' {
  const lower = msg.toLowerCase()
  if (lower.includes('error') || lower.includes('fail') || lower.includes('critical')) return 'error'
  if (lower.includes('warn') || lower.includes('timeout') || lower.includes('miss')) return 'warning'
  return 'info'
}

function parseChromeAppLog(maxLines = 200): LogEntry[] {
  // Try google-chrome first, then chromium
  const candidates = [
    path.join(os.homedir(), '.config', 'google-chrome', 'chrome_debug.log'),
    path.join(os.homedir(), '.config', 'chromium', 'chrome_debug.log'),
  ]

  for (const logPath of candidates) {
    try {
      if (!fs.existsSync(logPath)) continue
      const content = fs.readFileSync(logPath, 'utf8')
      const lines = content.trim().split('\n').slice(-maxLines)
      return lines
        .filter(line => line.trim())
        .map((line, i) => {
          // Chrome debug log format: "[PID:TID:MMDD/HHMMSS.ffffff:SEVERITY:source(line)] message"
          const match = line.match(/^\[(\d+):(\d+):(\d{4})\/(\d{6}\.\d+):(\w+):([^\]]+)\]\s*(.+)$/)
          if (match) {
            const [, , , dateStr, timeStr, severity, , message] = match
            const month = dateStr.slice(0, 2)
            const day = dateStr.slice(2, 4)
            const hour = timeStr.slice(0, 2)
            const min = timeStr.slice(2, 4)
            const sec = timeStr.slice(4, 6)
            const now = new Date()
            const ts = new Date(now.getFullYear(), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec))
            const level = severity === 'ERROR' || severity === 'FATAL' ? 'error'
              : severity === 'WARNING' ? 'warning' : 'info'
            return {
              id: `app-${i}`,
              timestamp: ts.toISOString(),
              level,
              service: 'chrome-app',
              message,
            }
          }
          // Fallback: plain line
          return {
            id: `app-${i}`,
            timestamp: new Date().toISOString(),
            level: classifyLevel(line),
            service: 'chrome-app',
            message: line,
          }
        })
    } catch {
      continue
    }
  }
  return []
}

function parseJournalLogs(maxLines = 200): LogEntry[] {
  const entries: LogEntry[] = []

  for (const { unit, label } of JOURNAL_UNITS) {
    try {
      const output = execFileSync('journalctl', [
        '--user', '-u', unit,
        '--no-pager', '-n', String(Math.ceil(maxLines / JOURNAL_UNITS.length)),
        '-o', 'short-iso',
      ], { encoding: 'utf8', timeout: 5000 })

      const lines = output.trim().split('\n').filter(l => l.trim() && !l.startsWith('--'))
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Format: "2026-03-16T03:04:57+0800 hostname unit[pid]: message"
        const match = line.match(/^(\S+)\s+\S+\s+\S+:\s+(.+)$/)
        if (!match) continue
        const [, tsRaw, message] = match
        const ts = new Date(tsRaw)
        if (isNaN(ts.getTime())) continue

        entries.push({
          id: `jrnl-${label}-${i}`,
          timestamp: ts.toISOString(),
          level: classifyLevel(message),
          service: label,
          message,
        })
      }
    } catch {
      // Service may not exist
    }
  }

  return entries
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source') || 'all'
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '300'), 1000)

  try {
    let logs: LogEntry[] = []

    if (source === 'app' || source === 'all') {
      logs.push(...parseChromeAppLog(limit))
    }
    if (source === 'journal' || source === 'all') {
      logs.push(...parseJournalLogs(limit))
    }

    // Sort by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    logs = logs.slice(0, limit)

    return NextResponse.json(logs)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
