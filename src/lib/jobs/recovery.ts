import { readAllJobsSync, upsertJobMeta, appendLogLine, compactAndPrune } from './store'
import { getVersionInfo } from '@/lib/version'
import type { JobMeta } from './types'
import { isJobLive } from './live'

const STALE_MS = 10 * 60 * 1000

function currentAppVersion(): string | null {
  try {
    return getVersionInfo().version
  } catch {
    return null
  }
}

/**
 * Reconcile one job left in 'running' / 'restarting'. Self-restart jobs that
 * match the running app version are promoted to 'success'; otherwise the job
 * becomes 'failed' when it is older than STALE_MS, or immediately when the
 * caller knows its process is gone (`knownDead`). Returns the new status, or
 * null when the job was left alone.
 */
function recoverJob(
  job: JobMeta,
  opts: { now: number; currentVersion: string | null; knownDead: boolean },
): 'success' | 'failed' | null {
  if (job.status !== 'running' && job.status !== 'restarting') return null
  const age = opts.now - Date.parse(job.startedAt)

  // Self-restart success path: MCC upgrade is 'restarting' and the running
  // app is now at expectedVersion. Promote to success.
  if (
    job.status === 'restarting' &&
    job.expectedVersion &&
    opts.currentVersion &&
    job.expectedVersion === opts.currentVersion
  ) {
    const finishedAt = new Date().toISOString()
    const updated = {
      ...job,
      status: 'success' as const,
      finishedAt,
      exitCode: 0,
      phases: job.phases.map((p, idx) =>
        idx === job.phases.length - 1 && p.status !== 'success'
          ? { ...p, status: 'success' as const, finishedAt, exitCode: 0 }
          : p,
      ),
    }
    upsertJobMeta(updated)
    appendLogLine(job.id, {
      ts: finishedAt,
      stream: 'system',
      text: `✓ restart complete — running v${opts.currentVersion}`,
    })
    return 'success'
  }

  // Anything that's been 'running' or 'restarting' past the stale threshold
  // (or whose process is known to be gone) is presumed dead.
  if (opts.knownDead || age > STALE_MS) {
    const finishedAt = new Date().toISOString()
    const updated = {
      ...job,
      status: 'failed' as const,
      finishedAt,
      exitCode: -1,
      phases: job.phases.map((p) =>
        p.status === 'running' || p.status === 'pending'
          ? { ...p, status: 'failed' as const, finishedAt }
          : p,
      ),
    }
    upsertJobMeta(updated)
    appendLogLine(job.id, {
      ts: finishedAt,
      stream: 'system',
      text: '✗ orphan recovered — process did not finish',
    })
    return 'failed'
  }
  return null
}

/**
 * On boot (or first read after a restart), reconcile jobs left in 'running' /
 * 'restarting' state. Self-restart jobs that match the new app version are
 * promoted to 'success'; the rest, if older than STALE_MS, become 'failed'.
 *
 * Idempotent: it only flips state when the current state is clearly stale.
 */
let didRun = false
export function runOrphanRecoveryOnce(): void {
  if (didRun) return
  didRun = true
  try { compactAndPrune() } catch { /* non-fatal */ }

  const now = Date.now()
  const currentVersion = currentAppVersion()
  for (const job of readAllJobsSync()) {
    recoverJob(job, { now, currentVersion, knownDead: false })
  }
}

/**
 * 回收「不屬於本行程 runner」的 running / restarting job（見 live.ts：job 不會脫離 MCC 行程存活，
 * 所以它們一定是前一個行程留下的孤兒），不等 STALE_MS。先做與開機回收相同的處理（含自我重啟
 * 成功的升級標為 success）。`filter` 限定要處理哪些 job。回傳仍在本行程執行中的 job。
 */
export function reconcileOrphanedJobs(filter: (job: JobMeta) => boolean = () => true): JobMeta[] {
  runOrphanRecoveryOnce()
  const now = Date.now()
  const currentVersion = currentAppVersion()
  const alive: JobMeta[] = []
  for (const job of readAllJobsSync()) {
    if (job.status !== 'running' && job.status !== 'restarting') continue
    if (!filter(job)) continue
    if (isJobLive(job.id)) { alive.push(job); continue }
    try {
      recoverJob(job, { now, currentVersion, knownDead: true })
    } catch { /* 寫不進 index：仍視為孤兒，不擋 */ }
  }
  return alive
}
