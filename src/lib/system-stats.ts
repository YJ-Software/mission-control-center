import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function getMemoryStats() {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  return {
    total: totalMem,
    used: usedMem,
    free: freeMem,
    percent: Math.round((usedMem / totalMem) * 100),
    totalGB: (totalMem / 1073741824).toFixed(1),
    usedGB: (usedMem / 1073741824).toFixed(1),
  }
}

function getCpuTemp(): number | null {
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8').trim()
    return parseInt(raw, 10) / 1000
  } catch {
    return null
  }
}

function getCpuUsage(): number {
  const loadAvg1m = os.loadavg()[0]
  const numCpus = os.cpus().length
  return Math.min(Math.round((loadAvg1m / numCpus) * 100), 100)
}

function getDiskStats() {
  try {
    const df = runQuiet('df', ['/', '--output=pcent,used,size', '-BG'])
    const lines = df.split('\n')
    if (lines.length < 2) return { percent: 0, used: '', total: '' }
    const parts = lines[1].trim().split(/\s+/)
    return {
      percent: parseInt(parts[0], 10) || 0,
      used: (parts[1] || '').replace(/G$/, '') + 'G',
      total: (parts[2] || '').replace(/G$/, '') + 'G',
    }
  } catch {
    return { percent: 0, used: '', total: '' }
  }
}

function getCrashCounts() {
  let crashesToday = 0
  let crashCount = 0

  const grepPattern = 'SIGABRT\\|SIGSEGV\\|exit code [1-9]\\|process crashed\\|fatal error'

  // 7-day crashes
  for (const scope of ['', '--user']) {
    if (crashCount > 0) break
    try {
      const logs = runQuiet('bash', ['-c', `journalctl ${scope} -u openclaw --since '7 days ago' --no-pager -o short 2>/dev/null | grep -ci '${grepPattern}' || echo 0`])
      crashCount = parseInt(logs, 10) || 0
    } catch { /* ignore */ }
  }

  // Today crashes
  for (const scope of ['', '--user']) {
    if (crashesToday > 0) break
    try {
      const logs = runQuiet('bash', ['-c', `journalctl ${scope} -u openclaw --since today --no-pager -o short 2>/dev/null | grep -ci '${grepPattern}' || echo 0`])
      crashesToday = parseInt(logs, 10) || 0
    } catch { /* ignore */ }
  }

  return { crashesToday, crashCount }
}

// ---------------------------------------------------------------------------
// Slow-changing metrics cache (disk + crashes) — refresh every 30 minutes
// ---------------------------------------------------------------------------

const SLOW_CACHE_TTL = 30 * 60 * 1000

let cachedDisk = getDiskStats()
let cachedCrashes = getCrashCounts()
let slowCacheUpdatedAt = Date.now()

function getSlowMetrics() {
  const now = Date.now()
  if (now - slowCacheUpdatedAt > SLOW_CACHE_TTL) {
    cachedDisk = getDiskStats()
    cachedCrashes = getCrashCounts()
    slowCacheUpdatedAt = now
  }
  return { disk: cachedDisk, crashes: cachedCrashes }
}

export function getSystemStats() {
  const memory = getMemoryStats()
  const cpuTemp = getCpuTemp()
  const cpuUsage = getCpuUsage()
  const loadAvg = os.loadavg()
  const uptime = os.uptime()
  const { disk, crashes } = getSlowMetrics()

  return {
    cpu: { usage: cpuUsage, temp: cpuTemp },
    memory,
    disk,
    loadAvg: {
      '1m': loadAvg[0].toFixed(2),
      '5m': loadAvg[1].toFixed(2),
      '15m': loadAvg[2].toFixed(2),
    },
    uptime,
    crashesToday: crashes.crashesToday,
    crashCount: crashes.crashCount,
  }
}

export type SystemStats = ReturnType<typeof getSystemStats>

// ---------------------------------------------------------------------------
// Health history — keeps up to 288 snapshots (24h at 5min intervals)
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  t: number
  cpu: number
  ram: number
  temp: number
  disk: number
  load?: number
}

const MAX_SNAPSHOTS = 288
let healthHistory: HealthSnapshot[] = []
const historyFile = (() => {
  const dir = process.env.MISSION_CONTROL_DATA_DIR
    || join(os.homedir(), '.mission-control')
  return join(dir, 'health-history.json')
})()

import { join } from 'path'

// Load persisted history on module init
try {
  if (fs.existsSync(historyFile)) {
    healthHistory = JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
  }
} catch { /* ignore corrupt file */ }

function saveSnapshot() {
  try {
    const stats = getSystemStats()
    const numCpus = os.cpus().length || 1
    const loadPct = Math.min(Math.round((parseFloat(stats.loadAvg['1m']) / numCpus) * 100), 100)
    healthHistory.push({
      t: Date.now(),
      cpu: stats.cpu?.usage ?? 0,
      ram: stats.memory?.percent ?? 0,
      temp: stats.cpu?.temp ?? 0,
      disk: stats.disk?.percent ?? 0,
      load: loadPct,
    })
    if (healthHistory.length > MAX_SNAPSHOTS) {
      healthHistory = healthHistory.slice(-MAX_SNAPSHOTS)
    }
    const dir = join(historyFile, '..')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(historyFile, JSON.stringify(healthHistory))
  } catch { /* ignore */ }
}

// Record every 5 minutes
setInterval(saveSnapshot, 5 * 60 * 1000)
// Record immediately on first import
saveSnapshot()

export function getHealthHistory(): HealthSnapshot[] {
  return healthHistory
}
