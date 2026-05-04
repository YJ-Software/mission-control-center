import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TELEMETRY_PATH = join(homedir(), '.openclaw', 'mem0-telemetry.jsonl')

interface Event {
  ts: string
  action: 'add' | 'search' | 'list'
  user_id: string
  latency_ms: number
  success: boolean
  hits?: number
  content_len?: number
}

interface DayBucket {
  date: string
  add: number
  search: number
  list: number
  fail: number
  avgLatencyMs: number
}

export interface StatsResult {
  totalsLast7d: { add: number; search: number; list: number; fail: number }
  totalsLast30d: { add: number; search: number; list: number; fail: number }
  uniqueUsers7d: number
  avgLatencyMs7d: { add: number; search: number; list: number }
  buckets: DayBucket[]
  recent: Array<Pick<Event, 'ts' | 'action' | 'user_id' | 'latency_ms' | 'success'>>
  telemetryPath: string
  telemetryAvailable: boolean
  telemetrySize: number
}

const MAX_TAIL_BYTES = 2 * 1024 * 1024 // 2 MiB tail to keep memory in check

function readTail(): string[] {
  if (!existsSync(TELEMETRY_PATH)) return []
  const stat = statSync(TELEMETRY_PATH)
  if (stat.size === 0) return []
  let raw: string
  if (stat.size <= MAX_TAIL_BYTES) {
    raw = readFileSync(TELEMETRY_PATH, 'utf-8')
  } else {
    const fd = require('fs').openSync(TELEMETRY_PATH, 'r')
    try {
      const buf = Buffer.alloc(MAX_TAIL_BYTES)
      require('fs').readSync(fd, buf, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES)
      raw = buf.toString('utf-8')
    } finally {
      require('fs').closeSync(fd)
    }
    raw = raw.slice(raw.indexOf('\n') + 1) // drop partial first line
  }
  return raw.split('\n').filter((l) => l.trim().length > 0)
}

function parseEvents(lines: string[]): Event[] {
  const out: Event[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Event)
    } catch {
      /* skip malformed */
    }
  }
  return out
}

function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getStats(): StatsResult {
  const exists = existsSync(TELEMETRY_PATH)
  const size = exists ? statSync(TELEMETRY_PATH).size : 0

  if (!exists) {
    const empty: StatsResult = {
      totalsLast7d: { add: 0, search: 0, list: 0, fail: 0 },
      totalsLast30d: { add: 0, search: 0, list: 0, fail: 0 },
      uniqueUsers7d: 0,
      avgLatencyMs7d: { add: 0, search: 0, list: 0 },
      buckets: [],
      recent: [],
      telemetryPath: TELEMETRY_PATH,
      telemetryAvailable: false,
      telemetrySize: 0,
    }
    return empty
  }

  const events = parseEvents(readTail())
  const now = Date.now()
  const cutoff7 = now - 7 * 86400000
  const cutoff30 = now - 30 * 86400000

  const totalsLast7d = { add: 0, search: 0, list: 0, fail: 0 }
  const totalsLast30d = { add: 0, search: 0, list: 0, fail: 0 }
  const uniqueUsers = new Set<string>()
  const latency: Record<'add' | 'search' | 'list', number[]> = { add: [], search: [], list: [] }

  const bucketMap = new Map<string, DayBucket>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = dateKey(d)
    bucketMap.set(key, { date: key, add: 0, search: 0, list: 0, fail: 0, avgLatencyMs: 0 })
  }

  const dayLatencyTotals: Map<string, { sum: number; n: number }> = new Map()

  for (const e of events) {
    const ts = Date.parse(e.ts)
    if (Number.isNaN(ts)) continue

    if (ts >= cutoff30) {
      const target = ts >= cutoff7 ? totalsLast7d : totalsLast30d
      if (e.action in target) (target as any)[e.action]++
      if (!e.success) target.fail++
      if (ts >= cutoff7 && e.action in target) (totalsLast30d as any)[e.action]++
      if (ts >= cutoff7 && !e.success) totalsLast30d.fail++
    }

    if (ts >= cutoff7) {
      uniqueUsers.add(e.user_id)
      if (e.action in latency) latency[e.action].push(e.latency_ms)

      const dayKey = dateKey(new Date(ts))
      if (bucketMap.has(dayKey)) {
        const b = bucketMap.get(dayKey)!
        if (e.action in b) (b as any)[e.action]++
        if (!e.success) b.fail++
        const dl = dayLatencyTotals.get(dayKey) ?? { sum: 0, n: 0 }
        dl.sum += e.latency_ms
        dl.n += 1
        dayLatencyTotals.set(dayKey, dl)
      }
    }
  }

  for (const [k, b] of bucketMap.entries()) {
    const dl = dayLatencyTotals.get(k)
    if (dl && dl.n > 0) b.avgLatencyMs = Math.round(dl.sum / dl.n)
  }

  const buckets = [...bucketMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const avg = (arr: number[]) => (arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length))

  const recent = events
    .slice(-25)
    .reverse()
    .map((e) => ({
      ts: e.ts,
      action: e.action,
      user_id: e.user_id,
      latency_ms: e.latency_ms,
      success: e.success,
    }))

  return {
    totalsLast7d,
    totalsLast30d,
    uniqueUsers7d: uniqueUsers.size,
    avgLatencyMs7d: { add: avg(latency.add), search: avg(latency.search), list: avg(latency.list) },
    buckets,
    recent,
    telemetryPath: TELEMETRY_PATH,
    telemetryAvailable: true,
    telemetrySize: size,
  }
}
