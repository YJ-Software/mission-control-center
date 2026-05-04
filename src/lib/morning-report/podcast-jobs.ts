/**
 * In-memory tracker for async podcast generation jobs.
 *
 * Podcast generation runs 2–4 min and used to be exposed as a synchronous
 * POST. cron agents calling that POST via curl hit a 180 s exec-tool
 * timeout and reported "failure" even though the dashboard finished the
 * job in the background. Now POST returns 202 + jobId immediately and the
 * caller polls GET ?type=podcast-status&jobId=… for completion.
 *
 * State is per-process: a dashboard restart drops in-flight jobs. That's
 * fine — podcast jobs are short and rerunnable.
 */

import { randomBytes } from 'crypto'

export type PodcastJobStatus = 'pending' | 'running' | 'done' | 'error'

export interface PodcastJob {
  jobId: string
  status: PodcastJobStatus
  startedAt: number
  finishedAt?: number
  // Latest progress event from generatePodcast's onProgress callback
  progress?: { stage: string; message: string }
  // Filled when status === 'done'
  audioPath?: string
  audioUrl?: string
  tunnelUrl?: string
  // Filled when status === 'error'
  error?: string
}

const jobs = new Map<string, PodcastJob>()

// Drop completed jobs older than this so the map can't grow unbounded.
const JOB_TTL_MS = 60 * 60 * 1000 // 1 hour after finish

function pruneOld() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id)
    }
  }
}

export function createJob(): PodcastJob {
  pruneOld()
  const jobId = `pod-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const job: PodcastJob = { jobId, status: 'pending', startedAt: Date.now() }
  jobs.set(jobId, job)
  return job
}

export function getJob(jobId: string): PodcastJob | undefined {
  return jobs.get(jobId)
}

export function updateJob(jobId: string, patch: Partial<PodcastJob>): void {
  const job = jobs.get(jobId)
  if (!job) return
  Object.assign(job, patch)
}

/** Find the most recent job started on the given local date (YYYY-MM-DD).
 *  Used by the harvest endpoint when the cron-spawned trigger agent didn't
 *  hand back a jobId (intentional: trigger fires + exits, harvest looks up). */
export function findLatestForDate(dateYYYYMMDD: string): PodcastJob | undefined {
  // Match by date in local timezone — the trigger agent runs in the host's
  // tz, and so does this lookup, so a Date(startedAt).toISOString().slice(0,10)
  // mismatch is moot when both ends sit on the same box.
  let best: PodcastJob | undefined
  for (const job of jobs.values()) {
    const d = new Date(job.startedAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (key !== dateYYYYMMDD) continue
    if (!best || job.startedAt > best.startedAt) best = job
  }
  return best
}
