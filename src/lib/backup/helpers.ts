import { nanoid } from 'nanoid'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import path from 'path'
import os from 'os'
import fs from 'fs'

// --- ID generation ---
export function newId(): string {
  return nanoid(12)
}

// --- Schedule config validation ---
const VALID_HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12]

export interface HourlyConfig { interval: number }
export interface DailyConfig { days: number[]; time: string }
export interface WeeklyConfig { day: number; time: string }
export interface MonthlyConfig { dayOfMonth: number; time: string }
export type ScheduleConfig = HourlyConfig | DailyConfig | WeeklyConfig | MonthlyConfig

export function validateScheduleConfig(type: string, config: ScheduleConfig): string | null {
  if (type === 'hourly') {
    const c = config as HourlyConfig
    if (!VALID_HOURLY_INTERVALS.includes(c.interval)) {
      return `Invalid hourly interval: ${c.interval}. Must be one of ${VALID_HOURLY_INTERVALS.join(', ')}`
    }
  } else if (type === 'daily') {
    const c = config as DailyConfig
    if (!Array.isArray(c.days) || c.days.length === 0) return 'Daily schedule must have at least one day'
    if (c.days.some(d => d < 0 || d > 6)) return 'Day must be 0-6 (Sun-Sat)'
    if (!c.time) return 'Daily schedule must have a time'
  } else if (type === 'weekly') {
    const c = config as WeeklyConfig
    if (c.day < 0 || c.day > 6) return 'Day must be 0-6 (Sun-Sat)'
    if (!c.time) return 'Weekly schedule must have a time'
  } else if (type === 'monthly') {
    const c = config as MonthlyConfig
    if (c.dayOfMonth < 1 || c.dayOfMonth > 28) return 'Day of month must be 1-28'
    if (!c.time) return 'Monthly schedule must have a time'
  } else {
    return `Unknown schedule type: ${type}`
  }
  return null
}

// --- Schedule → Cron expression ---
export function scheduleToCron(type: string, config: ScheduleConfig): string {
  if (type === 'hourly') {
    const c = config as HourlyConfig
    return c.interval === 1 ? '0 * * * *' : `0 */${c.interval} * * *`
  }
  if (type === 'daily') {
    const c = config as DailyConfig
    const [hh, mm] = c.time.split(':').map(Number)
    return `${mm} ${hh} * * ${c.days.join(',')}`
  }
  if (type === 'weekly') {
    const c = config as WeeklyConfig
    const [hh, mm] = c.time.split(':').map(Number)
    return `${mm} ${hh} * * ${c.day}`
  }
  if (type === 'monthly') {
    const c = config as MonthlyConfig
    const [hh, mm] = c.time.split(':').map(Number)
    return `${mm} ${hh} ${c.dayOfMonth} * *`
  }
  throw new Error(`Unknown schedule type: ${type}`)
}

// --- Backup token ---
export function getOrCreateBackupToken(): string {
  const row = db.select().from(settings)
    .where(eq(settings.key, 'backupToken')).get()
  if (row?.value) return row.value
  const token = nanoid(32)
  db.insert(settings).values({ key: 'backupToken', value: token })
    .onConflictDoUpdate({ target: settings.key, set: { value: token } }).run()
  return token
}

export function verifyBackupToken(request: Request): boolean {
  const token = request.headers.get('x-backup-token')
  if (!token) return false
  const stored = getOrCreateBackupToken()
  return token === stored
}

// --- Scripts directory ---
export function getScriptsDir(): string {
  if (process.env.BACKUP_SCRIPTS_DIR) return process.env.BACKUP_SCRIPTS_DIR
  const row = db.select().from(settings)
    .where(eq(settings.key, 'backupScriptsDir')).get()
  if (row?.value) return row.value
  return path.join(os.homedir(), 'projects', 'myclaw-backup', 'scripts')
}

export const DEFAULT_BACKUP_DIR = path.join(os.homedir(), 'backup')

export function getBackupOutputDir(): string {
  const row = db.select().from(settings)
    .where(eq(settings.key, 'backupOutputDir')).get()
  if (row?.value) return row.value
  return DEFAULT_BACKUP_DIR
}

export function checkScriptsAvailable(): { ok: boolean; dir: string; missing: string[] } {
  const dir = getScriptsDir()
  const required = ['backup.sh', 'restore.sh']
  const missing = required.filter(f => !fs.existsSync(path.join(dir, f)))
  return { ok: missing.length === 0, dir, missing }
}

// --- Path helpers ---
export function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

// --- File size formatting ---
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
