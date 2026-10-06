import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { eq, desc } from 'drizzle-orm'
import { db, DB_PATH } from '@/lib/db'
import { startJob } from '@/lib/jobs/runner'
import type { JobMeta, TriggerSource } from '@/lib/jobs/types'
import { getVersionInfo } from '@/lib/version'
import { backupJobs, backupDestinations, backupSources, backupLogs } from './schema'
import { buildArchiveName, type BackupManifest } from './archive-format'
import { createOpenClawBackup, defaultOpenClawBackendRun } from './openclaw-backend'
import { snapshotMccDb, copyEnvFile } from './mcc-state'
import { expandHome, getBackupOutputDir, getAllBackupDirs } from './helpers'
import {
  isBackupOrRestoreBusy, setRunningLogId, runExtraBackup, uploadToFtp, deleteBackupFile,
} from './scripts'

/** 不含 OpenClaw 時 manifest.parts.backend 的佔位值（parseManifest 要求非空且不得為絕對路徑）。還原端以此判斷沒有 backend 部分。 */
export const BACKEND_NOT_INCLUDED = '(not-included)'

export class BackupJobNotFoundError extends Error {
  constructor() { super('Job not found') }
}
export class BackupBusyError extends Error {
  constructor() { super('A backup or restore is already running') }
}

type Log = (stream: 'stdout' | 'stderr' | 'system', text: string) => void

export interface BackupRunDeps {
  startJob: (spec: Parameters<typeof startJob>[0]) => JobMeta
  openclawCreate: (outDir: string, log: Log) => Promise<{ archivePath: string; version: string | null; warnings: string[] }>
  snapshotMccDb: (src: string, dest: string) => Promise<void>
  copyEnvFile: (src: string, dest: string) => boolean
  tar: (args: string[]) => Promise<void>
  uploadToFtp: typeof uploadToFtp
  runExtraBackup: typeof runExtraBackup
  now: () => Date
  hostname: () => string
  mccVersion: () => string
  dbPath: string
  envPath: string
}

export function defaultTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', args, { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(`tar failed: ${String(stderr).slice(-300) || err.message}`))
      else resolve()
    })
  })
}

const defaultDeps = (): BackupRunDeps => ({
  startJob,
  openclawCreate: (outDir, log) => {
    const refuse = async () => { throw new Error('gateway control is not available during backup') }
    return createOpenClawBackup(outDir, {
      run: defaultOpenClawBackendRun,
      fs,
      home: os.homedir(),
      gateway: { stop: refuse, start: refuse, waitHealthy: refuse as never },
      now: () => new Date(),
      log,
    })
  },
  snapshotMccDb,
  copyEnvFile,
  tar: defaultTar,
  uploadToFtp,
  runExtraBackup,
  now: () => new Date(),
  hostname: () => os.hostname(),
  mccVersion: () => getVersionInfo().mccVersion,
  dbPath: DB_PATH,
  // release 模式下 cwd/.env.local 是指向 state 目錄的 symlink，readFileSync 會跟隨
  envPath: path.join(process.cwd(), '.env.local'),
})


function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function startBackupRun(
  opts: { jobId?: string; destinationId?: string; sourceIds?: string[]; triggeredBy: TriggerSource },
  depsOverride?: Partial<BackupRunDeps>,
): { logId: number; jobMetaId: string } {
  const deps: BackupRunDeps = { ...defaultDeps(), ...depsOverride }

  // --- 解析 job / destination（可能丟錯，此時尚未上鎖、未建 log） ---
  let destConfig: Record<string, unknown> = {}
  let destType = 'local'
  let destName = 'Local'
  let sourceIds: string[] = opts.sourceIds ?? []
  let retainCount = 0
  let includeOpenClaw = true
  let destinationId = opts.destinationId

  if (opts.jobId) {
    const job = db.select().from(backupJobs).where(eq(backupJobs.id, opts.jobId)).get()
    if (!job) throw new BackupJobNotFoundError()
    destinationId = job.destinationId
    sourceIds = JSON.parse(job.sourceIds || '[]')
    retainCount = job.retainCount
    includeOpenClaw = job.includeOpenClaw !== 0
  }
  if (destinationId) {
    const dest = db.select().from(backupDestinations).where(eq(backupDestinations.id, destinationId)).get()
    if (dest) {
      destConfig = JSON.parse(dest.config)
      destType = dest.type
      destName = dest.name
    }
  }
  const jobId = opts.jobId
  const outputDir = destType === 'local' && destConfig.path
    ? expandHome(String(destConfig.path))
    : getBackupOutputDir()

  // --- 單一執行：同步檢查並上鎖（還原共用這把鎖） ---
  if (isBackupOrRestoreBusy()) throw new BackupBusyError()
  const inserted = db.insert(backupLogs).values({
    jobId: jobId || null,
    status: 'processing',
    destination: destName,
  }).returning({ id: backupLogs.id }).get()
  const logId = inserted.id
  setRunningLogId(logId)

  // --- 執行狀態 ---
  const now = deps.now()
  const stamp = String(now.getTime())
  const stagingDir = path.join(outputDir, `.mcc-backup-staging-${stamp}`)
  const tmpArchive = path.join(outputDir, `.mcc-backup-tmp-${stamp}.partial`)
  const finalPath = path.join(outputDir, buildArchiveName({ backend: 'openclaw', host: deps.hostname(), at: now }))
  const st = {
    finalWritten: false,
    extras: [] as string[],
    warnings: [] as string[],
    backendPart: BACKEND_NOT_INCLUDED,
    backendVersion: null as string | null,
    envCopied: false,
    finished: false,
  }

  const rmQuiet = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* best effort */ } }
  const cleanupTemp = () => { rmQuiet(stagingDir); rmQuiet(tmpArchive) }
  const finalize = () => {
    if (st.finished) return
    st.finished = true
    cleanupTemp()
    setRunningLogId(null)
  }
  const failRun = (phase: string, err: unknown, log?: Log) => {
    const msg = `${phase}: ${errText(err)}`
    log?.('stderr', msg)
    try {
      cleanupTemp()
      if (st.finalWritten) rmQuiet(finalPath)
      for (const f of st.extras) rmQuiet(f)
      db.update(backupLogs).set({
        status: 'failed',
        completedAt: Math.floor(Date.now() / 1000),
        error: msg,
      }).where(eq(backupLogs.id, logId)).run()
    } catch { /* 清理失敗不可擋住解鎖 */ }
    finalize()
  }
  const phase = (name: string, fn: (log: Log) => Promise<void>) => ({
    name,
    inline: async (log: Log) => {
      try { await fn(log); return 0 } catch (e) { failRun(name, e, log); return 1 }
    },
  })
  const ensureStaging = () => {
    if (fs.existsSync(stagingDir)) return
    fs.mkdirSync(outputDir, { recursive: true })
    fs.mkdirSync(stagingDir, { mode: 0o700 })
    fs.chmodSync(stagingDir, 0o700)
  }

  const phases = []

  if (includeOpenClaw) {
    phases.push(phase('openclaw backup create', async (log) => {
      ensureStaging()
      const r = await deps.openclawCreate(stagingDir, log)
      st.backendPart = path.basename(r.archivePath)
      st.backendVersion = r.version
      st.warnings.push(...r.warnings)
    }))
  }

  phases.push(phase('snapshot MCC database', async (log) => {
    ensureStaging()
    await deps.snapshotMccDb(deps.dbPath, path.join(stagingDir, 'mcc.sqlite'))
    st.envCopied = deps.copyEnvFile(deps.envPath, path.join(stagingDir, 'mcc.env'))
    if (!st.envCopied) log('system', '.env.local 不存在，略過')
  }))

  phases.push(phase('package archive', async (log) => {
    const manifest: BackupManifest = {
      format: 1,
      backend: 'openclaw',
      backendVersion: st.backendVersion,
      mccVersion: deps.mccVersion(),
      createdAt: now.toISOString(),
      hostname: deps.hostname(),
      parts: {
        backend: st.backendPart,
        mccDb: 'mcc.sqlite',
        mccEnv: st.envCopied ? 'mcc.env' : null,
      },
    }
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    await deps.tar(['czf', tmpArchive, '-C', stagingDir, '.'])
    fs.chmodSync(tmpArchive, 0o600)
    if (fs.existsSync(finalPath)) throw new Error(`target file already exists: ${path.basename(finalPath)}`)
    fs.renameSync(tmpArchive, finalPath)
    st.finalWritten = true
    rmQuiet(stagingDir)
    log('system', `archive: ${finalPath}`)
  }))

  if (sourceIds.length > 0) {
    phases.push(phase('extra folders', async (log) => {
      for (const sourceId of sourceIds) {
        const source = db.select().from(backupSources).where(eq(backupSources.id, sourceId)).get()
        if (!source?.enabled) continue
        const r = await deps.runExtraBackup(source.path, outputDir, source.name)
        if (r.filePath) st.extras.push(r.filePath)
        if (r.warning) { st.warnings.push(r.warning); log('system', r.warning) }
      }
    }))
  }

  if (destType === 'ftp' && destConfig.ip) {
    phases.push(phase('upload', async () => {
      await deps.uploadToFtp(finalPath, destConfig as Parameters<typeof uploadToFtp>[1])
    }))
  }

  phases.push(phase('record result', async () => {
    db.update(backupLogs).set({
      status: 'completed',
      completedAt: Math.floor(Date.now() / 1000),
      fileSize: fs.statSync(finalPath).size,
      filePath: finalPath,
      extraFilePaths: st.extras.length > 0 ? JSON.stringify(st.extras) : null,
      // 完成但有警告沿用 error 欄位呈現
      error: st.warnings.length > 0 ? st.warnings.join('\n') : null,
    }).where(eq(backupLogs.id, logId)).run()
  }))

  // retention 在 completed 之後執行，任何錯誤都只記警告，絕不讓備份變 failed
  phases.push({
    name: 'retention',
    inline: async (log: Log) => {
      try {
        if (retainCount > 0 && jobId) {
          const logs = db.select().from(backupLogs)
            .where(eq(backupLogs.jobId, jobId))
            .orderBy(desc(backupLogs.startedAt), desc(backupLogs.id)).all()
            .filter((l) => l.status === 'completed')
          if (logs.length > retainCount) {
            const dirs = getAllBackupDirs()
            for (const old of logs.slice(retainCount)) {
              const files: string[] = []
              if (old.filePath) files.push(old.filePath)
              if (old.extraFilePaths) {
                try { files.push(...(JSON.parse(old.extraFilePaths) as string[])) } catch { /* ignore */ }
              }
              let allOk = true
              for (const f of files) {
                try { deleteBackupFile(f, dirs) } catch (e) {
                  allOk = false
                  log('stderr', `WARNING retention: ${f}: ${errText(e)}`)
                }
              }
              if (allOk) db.update(backupLogs).set({ status: 'canceled' }).where(eq(backupLogs.id, old.id)).run()
            }
          }
        }
      } catch (e) {
        log('stderr', `WARNING retention: ${errText(e)}`)
      } finally {
        finalize()
      }
      return 0
    },
  })

  let meta: JobMeta
  try {
    meta = deps.startJob({
      kind: 'backup-run',
      label: 'MCC 備份',
      triggeredBy: opts.triggeredBy,
      phases,
    })
  } catch (e) {
    failRun('start job', e)
    throw e
  }
  return { logId, jobMetaId: meta.id }
}
