import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error'
  service: string
  message: string
}

const JOURNAL_SERVICES = [
  { unit: 'obsidian-headless.service', label: 'obsidian' },
  { unit: 'xvfb.service', label: 'xvfb' },
  { unit: 'openbox.service', label: 'openbox' },
  { unit: 'x11vnc.service', label: 'x11vnc' },
  { unit: 'websockify.service', label: 'websockify' },
]

function classifyLevel(msg: string): 'info' | 'warning' | 'error' {
  const lower = msg.toLowerCase()
  if (lower.includes('error') || lower.includes('fail') || lower.includes('critical')) return 'error'
  if (lower.includes('warn') || lower.includes('timeout') || lower.includes('miss')) return 'warning'
  return 'info'
}

function parseObsidianLog(maxLines = 200): LogEntry[] {
  const logPath = path.join(os.homedir(), '.config/obsidian/obsidian.log')
  try {
    const content = fs.readFileSync(logPath, 'utf8')
    const lines = content.trim().split('\n').slice(-maxLines)
    return lines
      .filter(line => line.trim())
      .map((line, i) => {
        // Format: "2026-01-31 15:51:56 Loading main app package..."
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.+)$/)
        if (!match) return null
        const [, timestamp, message] = match
        return {
          id: `app-${i}`,
          timestamp: new Date(timestamp).toISOString(),
          level: classifyLevel(message),
          service: 'obsidian-app',
          message,
        }
      })
      .filter((e): e is LogEntry => e !== null)
  } catch {
    return []
  }
}

function parseJournalLogs(maxLines = 200): LogEntry[] {
  const entries: LogEntry[] = []

  for (const { unit, label } of JOURNAL_SERVICES) {
    try {
      const output = execFileSync('journalctl', [
        '--user', '-u', unit,
        '--no-pager', '-n', String(Math.ceil(maxLines / JOURNAL_SERVICES.length)),
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
      logs.push(...parseObsidianLog(limit))
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
