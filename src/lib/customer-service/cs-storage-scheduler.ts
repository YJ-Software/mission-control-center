import { runRetentionSweep, getStorageStats, readStorageSettings } from './cs-storage'
import { purgeExpiredPauses } from './cs-store'
import { createNotification } from '@/lib/notifications'

const DAY_MS = 24 * 60 * 60 * 1000
const BOOT_DELAY_MS = 60 * 1000  // wait a minute after boot so we don't fight init

let started = false

function checkThreshold(): void {
  const { warnThresholdMb } = readStorageSettings()
  const { mediaBytes, mediaFiles } = getStorageStats()
  const mb = mediaBytes / 1024 / 1024
  if (mb < warnThresholdMb) return

  // Dedup key uses the current day so we re-emit at most once per day even
  // if the operator clears it; matches the daily sweep cadence.
  const dayKey = new Date().toISOString().slice(0, 10)
  createNotification({
    type: 'cs-storage',
    severity: 'warning',
    title: `客服儲存空間超過閾值 (${mb.toFixed(0)} / ${warnThresholdMb} MB)`,
    body: `${mediaFiles} 個媒體檔。可在 客服 → 設定 → 儲存空間 調整保存期限或閾值。`,
    link: '/customer-service',
    dedupKey: `cs-storage-warn-${dayKey}`,
  })
}

async function tick(): Promise<void> {
  try {
    const r = runRetentionSweep()
    if (r.tombstoned > 0 || r.unlinked > 0) {
      console.log(`[cs-storage] daily sweep: tombstoned=${r.tombstoned} unlinked=${r.unlinked} freed=${(r.bytesFreed / 1024 / 1024).toFixed(1)}MB`)
    }
    // Piggy-back: purge cs_agent_pause rows whose auto-resume already
    // fired but which never got cleaned up (e.g. server restarted before
    // the in-memory timer ran, or operator unticked early in odd ways).
    // Stale rows are harmless for the gate-check (isPaused already
    // returns false once resumeAt < now) but pile up in the DB.
    const purged = purgeExpiredPauses()
    if (purged > 0) {
      console.log(`[cs-storage] purged ${purged} expired pause rows`)
    }
    checkThreshold()
  } catch (err) {
    console.error('[cs-storage] sweep error:', err)
  }
}

/**
 * Start the daily storage retention + threshold scheduler. Idempotent —
 * safe to call multiple times (e.g. HMR in dev). First tick fires
 * BOOT_DELAY_MS after start; subsequent ticks every 24h.
 */
export function startCsStorageScheduler(): void {
  if (started) return
  started = true
  setTimeout(() => {
    void tick()
    setInterval(() => { void tick() }, DAY_MS)
  }, BOOT_DELAY_MS)
}
