import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { eq, desc } from 'drizzle-orm'
import { db, DB_PATH } from '@/lib/db'
import { startJob, type PhaseSpec } from '@/lib/jobs/runner'
import type { JobMeta, TriggerSource } from '@/lib/jobs/types'
import { getVersionInfo } from '@/lib/version'
import { backupJobs, backupDestinations, backupSources, backupLogs } from './schema'
import { buildArchiveName, type BackupManifest } from './archive-format'
import { createOpenClawBackup, defaultOpenClawBackendRun } from './openclaw-backend'
import { snapshotMccDb, copyEnvFile } from './mcc-state'
import { expandHome, getBackupOutputDir, getAllBackupDirs } from './helpers'
import { BackupBusyError, isBackupOrRestoreBusy, acquireLock, releaseLock } from './lock'
import { assertNoBlockingJob } from './job-guard'
import {
  runExtraBackup, uploadToFtp, deleteBackupFile,
} from './scripts'

export class BackupJobNotFoundError extends Error {
  constructor() { super('Job not found') }
}
export { BackupBusyError }

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
  findBlockingJob?: () => import('@/lib/jobs/types').JobMeta | null
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


/** 輸出目錄中所有暫存物（staging、私有 tar/extra 目錄、.partial）都用這個前綴，下次執行開頭整批清掃 */
export const TEMP_PREFIX = '.mcc-backup-'

function sweepOrphans(dir: string) {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n.startsWith(TEMP_PREFIX)) {
      try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function startBackupRun(
  opts: { jobId?: string; destinationId?: string; sourceIds?: string[]; triggeredBy: TriggerSource },
  depsOverride?: Partial<BackupRunDeps>,
): { logId: number; jobMetaId: string } {
  const deps: BackupRunDeps = { ...defaultDeps(), ...depsOverride }

  // --- 解析 job / destination、計算名稱（可能丟錯，此時尚未上鎖、未建 log） ---
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
  // resolve：相對路徑不可跟著 cwd 漂移（release 模式 cwd 是會被換掉的版本目錄）
  const outputDir = path.resolve(
    destType === 'local' && destConfig.path ? expandHome(String(destConfig.path)) : getBackupOutputDir(),
  )
  const now = deps.now()
  const stamp = String(now.getTime())
  const stagingDir = path.join(outputDir, `${TEMP_PREFIX}staging-${stamp}`)
  const finalPath = path.join(
    outputDir,
    buildArchiveName({ backend: 'openclaw', host: deps.hostname(), at: now }),
  )

  // --- 單一執行：同步檢查並上鎖（還原共用這把鎖） ---
  if (isBackupOrRestoreBusy()) throw new BackupBusyError()
  assertNoBlockingJob(deps.findBlockingJob)
  const logId = db.insert(backupLogs).values({
    jobId: jobId || null,
    status: 'processing',
    destination: destName,
  }).returning({ id: backupLogs.id }).get().id
  const lockToken = acquireLock(logId)

  const st = {
    tarDir: null as string | null,
    extraDir: null as string | null,
    finalWritten: false,
    extras: [] as string[],
    warnings: [] as string[],
    backendPart: null as string | null,
    backendVersion: null as string | null,
    envCopied: false,
    finished: false,
  }

  const rmQuiet = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* best effort */ } }
  const cleanupTemp = () => {
    rmQuiet(stagingDir)
    if (st.tarDir) rmQuiet(st.tarDir)
    if (st.extraDir) rmQuiet(st.extraDir)
  }
  /** 清理與解鎖：無條件、可重複呼叫、絕不丟錯 */
  const finalize = () => {
    if (st.finished) return
    st.finished = true
    try { cleanupTemp() } catch { /* ignore */ }
    releaseLock(lockToken)
  }
  const safeLog = (log?: Log): Log => (stream, text) => {
    try { log?.(stream, text) } catch { /* job log I/O（例如 ENOSPC）不可打斷清理 */ }
  }
  /** keep=true：保留本機封存檔與已完成的 extra（例如上傳失敗），並記錄路徑 */
  const failRun = (phaseName: string, err: unknown, log?: Log, keep = false) => {
    const msg = `${phaseName}: ${errText(err)}`
    safeLog(log)('stderr', msg)
    try {
      cleanupTemp()
      const values: Record<string, unknown> = {
        status: 'failed',
        completedAt: Math.floor(Date.now() / 1000),
        error: msg,
      }
      if (keep && st.finalWritten) {
        values.filePath = finalPath
        values.fileSize = fs.statSync(finalPath).size
        values.extraFilePaths = st.extras.length > 0 ? JSON.stringify(st.extras) : null
        values.error = `${msg}（本機備份檔已保留：${finalPath}）`
      } else {
        if (st.finalWritten) rmQuiet(finalPath)
        for (const f of st.extras) rmQuiet(f)
      }
      db.update(backupLogs).set(values).where(eq(backupLogs.id, logId)).run()
    } catch { /* 清理失敗不可擋住解鎖 */ }
    finalize()
  }
  const phase = (name: string, fn: (log: Log) => Promise<void>, keepOnFail = false) => ({
    name,
    inline: async (rawLog: Log) => {
      const log = safeLog(rawLog)
      try { await fn(log); return 0 } catch (e) { failRun(name, e, log, keepOnFail); return 1 }
    },
  })
  const ensureStaging = () => {
    if (fs.existsSync(stagingDir)) return
    fs.mkdirSync(stagingDir, { mode: 0o700 })
    fs.chmodSync(stagingDir, 0o700)
  }
  /** 私有（0700）暫存目錄：機敏檔案從建立起就不會被他人讀取 */
  const makePrivateDir = (name: string) => {
    const d = fs.mkdtempSync(path.join(outputDir, `${TEMP_PREFIX}${name}-`))
    fs.chmodSync(d, 0o700)
    return d
  }
  const uniqueDest = (name: string) => {
    const ext = '.tar.gz'
    const stem = name.endsWith(ext) ? name.slice(0, -ext.length) : name
    let candidate = path.join(outputDir, name)
    for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(outputDir, `${stem}_${i}${ext}`)
    return candidate
  }

  try {
    fs.mkdirSync(outputDir, { recursive: true })
    sweepOrphans(outputDir) // 單一執行保證：殘留的暫存物一定是上次中斷的孤兒

    const phases: PhaseSpec[] = []

    if (includeOpenClaw) {
      phases.push(phase('openclaw backup create', async (log) => {
        ensureStaging()
        const r = await deps.openclawCreate(stagingDir, log)
        const real = (p: string) => fs.realpathSync(p)
        let inside = false
        try {
          inside = real(path.dirname(path.resolve(r.archivePath))) === real(stagingDir)
            && fs.existsSync(r.archivePath)
        } catch { /* 視為不在 staging 內 */ }
        if (!inside) {
          rmQuiet(r.archivePath)
          throw new Error(`OpenClaw 備份檔不在預期的暫存目錄內：${r.archivePath}`)
        }
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
      // tar 寫進獨立的 0700 目錄：封存檔從建立起就不可被他人讀取，chmod 600 後才 rename 到最終名稱
      st.tarDir = makePrivateDir('tmp')
      const tmpArchive = path.join(st.tarDir, 'archive.partial')
      await deps.tar(['czf', tmpArchive, '--force-local', '-C', stagingDir, '.'])
      fs.chmodSync(tmpArchive, 0o600)
      if (fs.existsSync(finalPath)) throw new Error(`target file already exists: ${path.basename(finalPath)}`)
      fs.renameSync(tmpArchive, finalPath)
      st.finalWritten = true
      rmQuiet(stagingDir)
      rmQuiet(st.tarDir)
      log('system', `archive: ${finalPath}`)
    }))

    if (sourceIds.length > 0) {
      // extra 資料夾失敗只是警告：主備份檔是有效資料，不可因此丟棄
      phases.push(phase('extra folders', async (log) => {
        st.extraDir = makePrivateDir('extra')
        for (const sourceId of sourceIds) {
          const source = db.select().from(backupSources).where(eq(backupSources.id, sourceId)).get()
          if (!source?.enabled) continue
          try {
            const r = await deps.runExtraBackup(source.path, st.extraDir, source.name)
            if (r.filePath) {
              const dest = uniqueDest(path.basename(r.filePath))
              fs.renameSync(r.filePath, dest)
              st.extras.push(dest)
            }
            if (r.warning) { st.warnings.push(r.warning); log('system', r.warning) }
          } catch (e) {
            const w = `extra 資料夾「${source.name}」備份失敗（已略過）：${errText(e)}`
            st.warnings.push(w)
            log('stderr', w)
          }
        }
        rmQuiet(st.extraDir)
      }))
    }

    if (destType === 'ftp' && destConfig.ip) {
      phases.push(phase('upload', async () => {
        await deps.uploadToFtp(finalPath, destConfig as Parameters<typeof uploadToFtp>[1])
      }, true))
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
      inline: async (rawLog: Log) => {
        const log = safeLog(rawLog)
        try {
          if (retainCount > 0 && jobId) {
            const logs = db.select().from(backupLogs)
              .where(eq(backupLogs.jobId, jobId))
              .orderBy(desc(backupLogs.startedAt), desc(backupLogs.id)).all()
              .filter((l) => l.status === 'completed')
            if (logs.length > retainCount) {
              const dirs = getAllBackupDirs()
              for (const old of logs.slice(retainCount)) {
                let mainPath: string | null = old.filePath
                let extras: string[] = []
                if (old.extraFilePaths) {
                  try { extras = JSON.parse(old.extraFilePaths) as string[] } catch { /* ignore */ }
                }
                const tryDelete = (f: string) => {
                  try { deleteBackupFile(f, dirs); return true } catch (e) {
                    log('stderr', `WARNING retention: ${f}: ${errText(e)}`)
                    return false
                  }
                }
                if (mainPath && tryDelete(mainPath)) mainPath = null
                extras = extras.filter((f) => !tryDelete(f))
                if (!mainPath && extras.length === 0) {
                  db.update(backupLogs).set({ status: 'canceled' }).where(eq(backupLogs.id, old.id)).run()
                } else {
                  // 只剩刪不掉的路徑：寫回剩餘，不留指向已刪檔案的紀錄
                  db.update(backupLogs).set({
                    filePath: mainPath,
                    extraFilePaths: extras.length > 0 ? JSON.stringify(extras) : null,
                  }).where(eq(backupLogs.id, old.id)).run()
                }
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

    const meta = deps.startJob({
      kind: 'backup-run',
      label: 'MCC 備份',
      triggeredBy: opts.triggeredBy,
      phases,
      // 保底：即使 runner 自己的 I/O 丟錯、沒跑到最後一個 phase，也一定解鎖並收尾
      onSettled: () => {
        if (st.finished) return
        try {
          const cur = db.select().from(backupLogs).where(eq(backupLogs.id, logId)).get()
          // 封存檔已 rename 成最終名稱就是有效資料：保留並在 error 指出路徑
          if (cur?.status === 'processing') failRun('job runner', '工作在完成前中斷', undefined, true)
          else finalize()
        } catch {
          finalize()
        }
      },
    })
    return { logId, jobMetaId: meta.id }
  } catch (e) {
    failRun('start job', e)
    throw e
  }
}
