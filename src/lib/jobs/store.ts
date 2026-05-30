import { promises as fsp, existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync, statSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { JobMeta, LogLine } from './types'

const DATA_DIR = process.env.MISSION_CONTROL_DATA_DIR || join(homedir(), '.mission-control')
const JOBS_DIR = join(DATA_DIR, 'jobs')
const INDEX_PATH = join(JOBS_DIR, 'index.jsonl')

function ensureDir() {
  if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true })
}

export function jobLogPath(id: string): string {
  return join(JOBS_DIR, `${id}.log`)
}

/**
 * Append-only index. Each upsert writes a fresh full JSON line; readers fold
 * by id and keep only the latest.
 */
export function upsertJobMeta(meta: JobMeta): void {
  ensureDir()
  appendFileSync(INDEX_PATH, JSON.stringify(meta) + '\n')
}

export function appendLogLine(id: string, line: LogLine): void {
  ensureDir()
  appendFileSync(jobLogPath(id), JSON.stringify(line) + '\n')
}

export async function readAllJobs(): Promise<JobMeta[]> {
  if (!existsSync(INDEX_PATH)) return []
  const raw = await fsp.readFile(INDEX_PATH, 'utf8')
  const folded = new Map<string, JobMeta>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const meta = JSON.parse(trimmed) as JobMeta
      folded.set(meta.id, meta)
    } catch {
      // ignore corrupt lines
    }
  }
  return [...folded.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function getJob(id: string): Promise<JobMeta | null> {
  const all = await readAllJobs()
  return all.find((j) => j.id === id) ?? null
}

export async function readJobLog(id: string): Promise<LogLine[]> {
  const path = jobLogPath(id)
  if (!existsSync(path)) return []
  const raw = await fsp.readFile(path, 'utf8')
  const lines: LogLine[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed) as LogLine)
    } catch {
      // ignore
    }
  }
  return lines
}

/** Synchronous read for boot-time recovery (no top-level await). */
export function readAllJobsSync(): JobMeta[] {
  if (!existsSync(INDEX_PATH)) return []
  const raw = readFileSync(INDEX_PATH, 'utf8')
  const folded = new Map<string, JobMeta>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const meta = JSON.parse(trimmed) as JobMeta
      folded.set(meta.id, meta)
    } catch {
      // ignore
    }
  }
  return [...folded.values()]
}

export function jobsDir(): string {
  return JOBS_DIR
}

export function newJobId(): string {
  // 26-char ulid-ish (timestamp + random) — no extra deps
  const ts = Date.now().toString(36).padStart(9, '0')
  const rand = Math.random().toString(36).slice(2, 14).padStart(12, '0')
  return `${ts}${rand}`
}

const RETENTION_MAX = 200
const COMPACT_BYTES_THRESHOLD = 256 * 1024 // 256 KB

/**
 * Compact index.jsonl (keep only the latest state per job) and evict jobs
 * beyond the retention cap. Returns the list of jobs that survived.
 *
 * Safe to call from any thread that owns the data dir; we never running jobs.
 */
export function compactAndPrune(): JobMeta[] {
  ensureDir()
  if (!existsSync(INDEX_PATH)) return []

  let needCompact = false
  try {
    const size = statSync(INDEX_PATH).size
    if (size > COMPACT_BYTES_THRESHOLD) needCompact = true
  } catch {
    return []
  }

  const folded = new Map<string, JobMeta>()
  for (const line of readFileSync(INDEX_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const meta = JSON.parse(trimmed) as JobMeta
      folded.set(meta.id, meta)
    } catch {
      // ignore
    }
  }

  const sorted = [...folded.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  // Always keep running/restarting jobs even if they would otherwise be evicted.
  const kept: JobMeta[] = []
  const evicted: JobMeta[] = []
  for (const meta of sorted) {
    if (kept.length < RETENTION_MAX) kept.push(meta)
    else if (meta.status === 'running' || meta.status === 'restarting') kept.push(meta)
    else evicted.push(meta)
  }

  if (evicted.length === 0 && !needCompact) return kept

  // Rewrite index atomically.
  const tmp = INDEX_PATH + '.tmp'
  writeFileSync(tmp, kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length ? '\n' : ''))
  try {
    // renameSync is atomic on POSIX.
    renameSync(tmp, INDEX_PATH)
  } catch {
    return kept
  }

  // Delete evicted log files.
  for (const meta of evicted) {
    try { unlinkSync(jobLogPath(meta.id)) } catch {}
  }

  return kept
}
