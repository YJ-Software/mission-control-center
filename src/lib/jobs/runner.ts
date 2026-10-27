import { spawn } from 'child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobKind, JobMeta, JobPhase, LogLine, LogStream, TriggerSource } from './types'
import { appendLogLine, newJobId, upsertJobMeta } from './store'
import { emitJobEvent } from './sse'
import { markJobLive, markJobDone } from './live'
import { LONG_RUNNING_JOB_KINDS, registerLongRun, unregisterLongRun, updateLongRun } from '@/lib/long-running'

// Augment PATH for spawned shells. systemd user units inherit a slim PATH and
// `bash -lc` is unreliable on Ubuntu (~/.bashrc returns early when non-interactive,
// so its npm-global/brew exports never run). We prepend the common per-user bin
// dirs ourselves so CLIs like `openclaw` resolve regardless of unit env.
let cachedPath: string | null = null
function augmentedPath(): string {
  if (cachedPath !== null) return cachedPath
  const home = os.homedir()
  const candidates = [
    // Dir of the node running THIS process. For nvm/Volta installs the managed
    // `openclaw` lives beside `node` here, so this must come FIRST — otherwise a
    // stale global (e.g. an old linuxbrew openclaw) wins and can mismatch the
    // gateway's install, which is what let the update button trigger a downgrade.
    path.dirname(process.execPath),
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

/** The PATH job shells run with — preflights use it to resolve the same `openclaw`/`node` the phase will */
export function jobShellPath(): string {
  return augmentedPath()
}

export interface PhaseContext {
  /** mutate the job's expectedVersion (used by upgrade flows to record the target after extraction) */
  setExpectedVersion: (v: string) => void
  /** publish a key/value pair to the job meta (e.g. device-code URL + user code) */
  setExtra: (key: string, value: string) => void
}

export interface PhaseSpec {
  name: string
  /** spawn-based step */
  shell?: string
  /** inline JS step — receives a logger and returns exit code (0 = success) */
  inline?: (log: (stream: LogStream, text: string) => void, ctx: PhaseContext) => Promise<number>
  /** if true, even a non-zero exit doesn't fail the job (e.g. doctor warnings) */
  allowFailure?: boolean
  /** 前面的 phase 失敗也照跑（收尾用，例如把升級前停掉的服務啟動回來）；它自己失敗一樣讓 job 失敗 */
  alwaysRun?: boolean
  /** shell phase 的時限：逾時先 SIGTERM 整個行程群組，10 秒後還在就 SIGKILL，phase 以 124 結束（再 15 秒 pipe 仍沒關也不等） */
  timeoutMs?: number
}

export interface JobSpec {
  kind: JobKind
  label: string
  triggeredBy: TriggerSource
  phases: PhaseSpec[]
  expectedVersion?: string
  /** mark the job as 'restarting' before the last phase (for self-restart flows) */
  restartingBeforeLastPhase?: boolean
  /** 工作結束後（不論成功、失敗、或 runner 自身丟錯）一定會呼叫一次，用來做保底清理 */
  onSettled?: () => void
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

async function runShellPhase(
  jobId: string, phaseIndex: number, cmd: string, longRunId: number | null = null, timeoutMs?: number,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn('bash', ['-c', cmd], {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      // 有時限的 phase 自成行程群組，逾時才能連同 bash 底下的子孫一起收掉
      detached: timeoutMs !== undefined,
    })
    let timedOut = false
    let settled = false
    const timers: NodeJS.Timeout[] = []
    const finish = (code: number) => {
      if (settled) return
      settled = true
      timers.forEach(clearTimeout)
      resolve(code)
    }
    const killGroup = (signal: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, signal) } catch { /* 已結束 */ }
    }
    if (timeoutMs !== undefined) {
      timers.push(setTimeout(() => {
        timedOut = true
        logTo(jobId, phaseIndex, 'stderr', `timed out after ${Math.round(timeoutMs / 1000)}s — sending SIGTERM`)
        killGroup('SIGTERM')
        timers.push(setTimeout(() => {
          killGroup('SIGKILL')
          // 有子孫行程另開行程群組又握著 stdout pipe 時 'close' 永遠不會來：不再等，讓後面的收尾 phase 照跑
          timers.push(setTimeout(() => {
            logTo(jobId, phaseIndex, 'stderr', 'output pipe still open 15s after SIGKILL — a detached child may still be running; giving up on it')
            finish(124)
          }, 15_000))
        }, 10_000))
      }, timeoutMs))
    }
    if (longRunId !== null) {
      updateLongRun(longRunId, { pid: child.pid ?? null })
      // exit 時就清掉 PID（close 可能延後）：登記項留到 job 結束才註銷，死 PID 清理不會誤刪
      child.on('exit', () => updateLongRun(longRunId, { pid: null }))
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => logTo(jobId, phaseIndex, 'stdout', d))
    child.stderr.on('data', (d: string) => logTo(jobId, phaseIndex, 'stderr', d))
    child.on('error', (err) => {
      if (settled) return
      logTo(jobId, phaseIndex, 'stderr', `spawn error: ${err.message}`)
      finish(127)
    })
    child.on('close', (code) => {
      if (longRunId !== null) updateLongRun(longRunId, { pid: null })
      finish(timedOut ? 124 : (code ?? 0))
    })
  })
}

/**
 * Run a job. Returns the JobMeta synchronously (with status: 'running') so
 * callers can return a jobId immediately. The actual work runs in the
 * background and updates the index as phases complete.
 */
export function startJob(spec: JobSpec): JobMeta {
  // apt/npm 類 job 整段登記為長時間作業：MCC 自己的重啟路徑看到就 409（見 long-running.ts）。
  // 放在寫任何 job 紀錄之前：MCC 即將重啟時 registerLongRun 會丟 RestartPendingError，不可留下永遠 running 的 job
  const longRunId = LONG_RUNNING_JOB_KINDS.has(spec.kind) ? registerLongRun(spec.label, { kind: spec.kind }) : null
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

  // Detach the async work. 從這裡起直到 finally，本行程都視這個 job 為執行中（見 live.ts）
  markJobLive(id)
  void (async () => {
   try {
    let overallFailed = false
    for (let i = 0; i < spec.phases.length; i++) {
      const phaseSpec = spec.phases[i]
      // 已有 phase 失敗：只跑標了 alwaysRun 的收尾 phase，其餘標為 skipped
      if (overallFailed && !phaseSpec.alwaysRun) {
        meta.phases[i] = { ...meta.phases[i], status: 'skipped' }
        emitMeta(meta)
        continue
      }
      meta.phases[i] = { ...meta.phases[i], status: 'running', startedAt: nowIso() }
      emitMeta(meta)
      logTo(id, i, 'phase', `── ${phaseSpec.name} ──`)
      if (longRunId !== null) updateLongRun(longRunId, { step: phaseSpec.name })

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
              setExtra: (key, value) => {
                meta.extra = { ...(meta.extra ?? {}), [key]: value }
                emitMeta(meta)
              },
            },
          )
        } else if (phaseSpec.shell) {
          code = await runShellPhase(id, i, phaseSpec.shell, longRunId, phaseSpec.timeoutMs)
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

      if (!ok) overallFailed = true
    }

    meta.status = overallFailed ? 'failed' : 'success'
    meta.finishedAt = nowIso()
    meta.exitCode = overallFailed ? 1 : 0
    upsertJobMeta(meta)
    emitJobEvent({ type: 'end', jobId: id, meta })
    logTo(id, undefined, 'system', overallFailed ? '✗ failed' : '✓ done')
   } finally {
    markJobDone(id)
    if (longRunId !== null) unregisterLongRun(longRunId)
    try { spec.onSettled?.() } catch { /* 保底清理不可再丟錯 */ }
   }
  })().catch((err) => console.error('[jobs] runner failed', err))

  return meta
}
