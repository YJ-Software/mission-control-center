import { clearPause, listActivePauses } from './cs-store'

const timers = new Map<string, NodeJS.Timeout>()

/**
 * Schedule auto-resume for one user. resumeAt is unix seconds. Replacing
 * an existing timer is safe — the old one fires nothing because we look up
 * the timer by userId before clearing.
 */
export function scheduleAutoResume(userId: string, resumeAtSec: number, onResume?: (userId: string) => void): void {
  const existing = timers.get(userId)
  if (existing) clearTimeout(existing)

  const delayMs = Math.max(0, resumeAtSec * 1000 - Date.now())
  const t = setTimeout(() => {
    timers.delete(userId)
    clearPause(userId)
    onResume?.(userId)
  }, delayMs)
  timers.set(userId, t)
}

export function cancelAutoResume(userId: string): void {
  const t = timers.get(userId)
  if (t) {
    clearTimeout(t)
    timers.delete(userId)
  }
}

/**
 * Restore pending timers from the DB after a server restart. Called once at
 * server boot from server.ts via initCustomerServiceRuntime().
 */
export function restoreAutoResumeTimers(onResume?: (userId: string) => void): number {
  const rows = listActivePauses()
  for (const r of rows) {
    scheduleAutoResume(r.userId, r.resumeAt, onResume)
  }
  return rows.length
}
