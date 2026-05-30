import { readAllJobsSync, upsertJobMeta, appendLogLine, compactAndPrune } from './store'
import { getVersionInfo } from '@/lib/version'

const STALE_MS = 10 * 60 * 1000

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

  const jobs = readAllJobsSync()
  const now = Date.now()
  const currentVersion = (() => {
    try {
      return getVersionInfo().version
    } catch {
      return null
    }
  })()

  for (const job of jobs) {
    if (job.status !== 'running' && job.status !== 'restarting') continue
    const startedAt = Date.parse(job.startedAt)
    const age = now - startedAt

    // Self-restart success path: MCC upgrade is 'restarting' and the running
    // app is now at expectedVersion. Promote to success.
    if (
      job.status === 'restarting' &&
      job.expectedVersion &&
      currentVersion &&
      job.expectedVersion === currentVersion
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
        text: `✓ restart complete — running v${currentVersion}`,
      })
      continue
    }

    // Anything that's been 'running' or 'restarting' past the stale threshold
    // is presumed dead.
    if (age > STALE_MS) {
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
    }
  }
}
