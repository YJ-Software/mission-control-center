import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import type { JobKind, JobMeta, JobPhase, LogLine, LogStream, TriggerSource } from './types'
import { appendLogLine, newJobId, upsertJobMeta } from './store'
import { emitJobEvent } from './sse'

// Augment PATH for spawned shells. systemd user units inherit a slim PATH and
// `bash -lc` is unreliable on Ubuntu (~/.bashrc returns early when non-interactive,
// so its npm-global/brew exports never run). We prepend the common per-user bin
// dirs ourselves so CLIs like `openclaw` resolve regardless of unit env.
let cachedPath: string | null = null
function augmentedPath(): string {
  if (cachedPath !== null) return cachedPath
  const home = os.homedir()
  const candidates = [
    `${home}/.npm-global/bin`,
    `${home}/.linuxbrew/bin`,
    '/home/linuxbrew/.linuxbrew/bin',
    `${home}/.local/bin`,
    '/usr/local/bin',
  ]
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean)
  const merged: string[] = []
  const seen = new Set<string>()
  for (const p of [...candidates.filter((p) => existsSync(p)), ...existing]) {
    if (seen.has(p)) continue
    seen.add(p)
    merged.push(p)
  }
  cachedPath = merged.join(':')
  return cachedPath
}

function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: augmentedPath() }
}

export interface PhaseContext {
  /** mutate the job's expectedVersion (used by upgrade flows to record the target after extraction) */
  setExpectedVersion: (v: string) => void
}

export interface PhaseSpec {
  name: string
  /** spawn-based step */
  shell?: string
  /** inline JS step — receives a logger and returns exit code (0 = success) */
  inline?: (log: (stream: LogStream, text: string) => void, ctx: PhaseContext) => Promise<number>
  /** if true, even a non-zero exit doesn't fail the job (e.g. doctor warnings) */
  allowFailure?: boolean
}

export interface JobSpec {
  kind: JobKind
  label: string
  triggeredBy: TriggerSource
  phases: PhaseSpec[]
  expectedVersion?: string
  /** mark the job as 'restarting' before the last phase (for self-restart flows) */
  restartingBeforeLastPhase?: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function logTo(jobId: string, phaseIndex: number | undefined, stream: LogStream, text: string) {
  // Split multi-line writes into individual log lines for cleaner viewing.
  for (const part of text.replace(/\r\n/g, '\n').split('\n')) {
    if (part.length === 0) continue
    const line: LogLine = { ts: nowIso(), stream, text: part, phaseIndex }
    appendLogLine(jobId, line)
    emitJobEvent({ type: 'log', jobId, line })
  }
}

function emitMeta(meta: JobMeta) {
  upsertJobMeta(meta)
  emitJobEvent({ type: 'meta', jobId: meta.id, meta })
}

async function runShellPhase(jobId: string, phaseIndex: number, cmd: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn('bash', ['-c', cmd], {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => logTo(jobId, phaseIndex, 'stdout', d))
    child.stderr.on('data', (d: string) => logTo(jobId, phaseIndex, 'stderr', d))
    child.on('error', (err) => {
      logTo(jobId, phaseIndex, 'stderr', `spawn error: ${err.message}`)
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 0))
  })
}

/**
 * Run a job. Returns the JobMeta synchronously (with status: 'running') so
 * callers can return a jobId immediately. The actual work runs in the
 * background and updates the index as phases complete.
 */
export function startJob(spec: JobSpec): JobMeta {
  const id = newJobId()
  const startedAt = nowIso()
  const phases: JobPhase[] = spec.phases.map((p) => ({ name: p.name, status: 'pending' }))

  const meta: JobMeta = {
    id,
    kind: spec.kind,
    label: spec.label,
    status: 'running',
    startedAt,
    finishedAt: null,
    exitCode: null,
    triggeredBy: spec.triggeredBy,
    phases,
    expectedVersion: spec.expectedVersion,
  }
  emitMeta(meta)
  logTo(id, undefined, 'system', `▶ ${spec.label}`)

  // Detach the async work.
  void (async () => {
    let overallFailed = false
    for (let i = 0; i < spec.phases.length; i++) {
      const phaseSpec = spec.phases[i]
      meta.phases[i] = { ...meta.phases[i], status: 'running', startedAt: nowIso() }
      emitMeta(meta)
      logTo(id, i, 'phase', `── ${phaseSpec.name} ──`)

      if (spec.restartingBeforeLastPhase && i === spec.phases.length - 1) {
        meta.status = 'restarting'
        emitMeta(meta)
      }

      let code = 0
      try {
        if (phaseSpec.inline) {
          code = await phaseSpec.inline(
            (stream, text) => logTo(id, i, stream, text),
            {
              setExpectedVersion: (v) => {
                meta.expectedVersion = v
                emitMeta(meta)
              },
            },
          )
        } else if (phaseSpec.shell) {
          code = await runShellPhase(id, i, phaseSpec.shell)
        } else {
          logTo(id, i, 'stderr', 'phase missing shell or inline')
          code = 2
        }
      } catch (err) {
        logTo(id, i, 'stderr', `phase threw: ${err instanceof Error ? err.message : String(err)}`)
        code = 1
      }

      // allowFailure tolerates non-zero exits (e.g. doctor warnings), but
      // 127 means the command itself was not found — that's never an allowable
      // outcome and silently green-ticking it hides real install/PATH bugs.
      if (code === 127 && phaseSpec.allowFailure) {
        logTo(id, i, 'stderr', 'command not found (exit 127) — refusing to allowFailure')
      }
      const ok = code === 0 || (!!phaseSpec.allowFailure && code !== 127)
      meta.phases[i] = {
        ...meta.phases[i],
        status: ok ? 'success' : 'failed',
        finishedAt: nowIso(),
        exitCode: code,
      }
      emitMeta(meta)

      if (!ok) {
        overallFailed = true
        // remaining phases stay pending; mark as skipped for clarity
        for (let j = i + 1; j < meta.phases.length; j++) {
          meta.phases[j] = { ...meta.phases[j], status: 'skipped' }
        }
        break
      }
    }

    meta.status = overallFailed ? 'failed' : 'success'
    meta.finishedAt = nowIso()
    meta.exitCode = overallFailed ? 1 : 0
    upsertJobMeta(meta)
    emitJobEvent({ type: 'end', jobId: id, meta })
    logTo(id, undefined, 'system', overallFailed ? '✗ failed' : '✓ done')
  })()

  return meta
}
