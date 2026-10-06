import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// 記憶體 DB 取代 @/lib/db，絕不碰 ~/.mission-control
const h = vi.hoisted(() => {
  // 真實 startJob 會寫 job store：導到 tmp，絕不碰 ~/.mission-control
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  const dataDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-jobs-data-'))
  process.env.MISSION_CONTROL_DATA_DIR = dataDir
  return { holder: {} as { db?: unknown }, dataDir }
})
vi.mock('@/lib/db', () => ({
  get db() { return h.holder.db },
  initDb: () => {},
  DB_PATH: '/nonexistent/db.sqlite',
}))

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as appSchema from '@/lib/schema'
import * as backupSchema from '@/lib/backup/schema'
import { startBackupRun, BackupBusyError, type BackupRunDeps } from '@/lib/backup/run-backup'
import { parseManifest } from '@/lib/backup/archive-format'
import { isBackupRunning, isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/scripts'
import { startJob, type JobSpec } from '@/lib/jobs/runner'
import { reconcileStaleBackupLogs, STALE_PROCESSING_ERROR } from '@/lib/backup/reconcile'

const { backupLogs, backupJobs, backupDestinations, backupSources } = backupSchema

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination_id TEXT NOT NULL, schedule_id TEXT NOT NULL, retain_count INTEGER NOT NULL DEFAULT 7, source_ids TEXT NOT NULL DEFAULT '[]', include_openclaw INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, cron_job_id TEXT, model TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending', started_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER, file_size INTEGER, file_path TEXT, extra_file_paths TEXT, destination TEXT, notes TEXT, error TEXT);
  `)
  return drizzle(sqlite, { schema: { ...appSchema, ...backupSchema } })
}

let tmp: string
let outDir: string
let defaultDir: string
let db: ReturnType<typeof makeDb>
let done: Promise<void>
let calls: string[]
let manifestAtTar: string | null
let stagingAtTar: string[]

let logger: (stream: 'stdout' | 'stderr' | 'phase' | 'system', text: string) => void = () => {}
let runnerThrowsAfter: number | null = null

function fakeStartJob(spec: JobSpec) {
  done = (async () => {
    try {
      let i = 0
      for (const p of spec.phases) {
        let code = 0
        try { code = await p.inline!(logger, { setExpectedVersion() {}, setExtra() {} }) } catch { code = 1 }
        if (code !== 0 && !p.allowFailure) break
        if (runnerThrowsAfter !== null && ++i > runnerThrowsAfter) throw new Error('runner I/O failed')
      }
    } catch { /* 模擬 runner 自身丟錯 */ } finally {
      spec.onSettled?.()
    }
  })()
  return { id: 'job-1' } as ReturnType<BackupRunDeps['startJob']>
}

function makeDeps(over: Partial<BackupRunDeps> = {}): BackupRunDeps {
  return {
    startJob: fakeStartJob,
    openclawCreate: async (dir) => {
      calls.push('openclaw')
      const p = path.join(dir, 'oc-backup.tar.gz')
      fs.writeFileSync(p, 'oc')
      return { archivePath: p, version: '2026.9.8', warnings: [] }
    },
    snapshotMccDb: async (_s, dest) => { calls.push('snapshot'); fs.writeFileSync(dest, 'db', { mode: 0o600 }) },
    copyEnvFile: (_s, dest) => { calls.push('env'); fs.writeFileSync(dest, 'K=V'); return true },
    tar: async (args) => {
      calls.push('tar')
      const staging = args[args.indexOf('-C') + 1]
      stagingAtTar = fs.readdirSync(staging).sort()
      manifestAtTar = fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8')
      fs.writeFileSync(args[1], 'archive-bytes')
    },
    uploadToFtp: async () => { calls.push('upload') },
    runExtraBackup: async (_p, dir, name) => {
      calls.push('extra')
      const fp = path.join(dir, `extra-backup_${name}_1.tar.gz`)
      fs.writeFileSync(fp, 'x')
      return { filename: path.basename(fp), size: 1, sizeHuman: '1 B', filePath: fp }
    },
    now: () => new Date(2026, 9, 6, 12, 0, 0),
    hostname: () => 'host1',
    mccVersion: () => '0.3.94',
    dbPath: path.join(tmp, 'db.sqlite'),
    envPath: path.join(tmp, '.env.local'),
    ...over,
  }
}

function leftovers() {
  return fs.readdirSync(outDir).filter((f) => f.startsWith('.mcc-backup'))
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-run-backup-'))
  outDir = path.join(tmp, 'out')
  fs.mkdirSync(outDir)
  db = makeDb()
  h.holder.db = db
  calls = []
  manifestAtTar = null
  stagingAtTar = []
  setRunningLogId(null)
  logger = () => {}
  runnerThrowsAfter = null
  // 預設輸出目錄也導到 tmp：FTP 目的地沒有 path，絕不能落到真實的 ~/backup
  // 預設目錄與目的地目錄刻意不同：retention 要靠 getAllBackupDirs 才刪得到目的地目錄的檔案
  defaultDir = path.join(tmp, 'default')
  fs.mkdirSync(defaultDir)
  db.insert(appSchema.settings).values({ key: 'backupOutputDir', value: defaultDir }).run()
  db.insert(backupDestinations).values({ id: 'd1', name: 'Local', type: 'local', config: JSON.stringify({ path: outDir }) }).run()
})
afterAll(() => { fs.rmSync(h.dataDir, { recursive: true, force: true }) })
afterEach(() => {
  setRunningLogId(null)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function addJob(over: Partial<typeof backupJobs.$inferInsert> = {}) {
  db.insert(backupJobs).values({ id: 'j1', name: 'J', destinationId: 'd1', scheduleId: 's', retainCount: 0, ...over }).run()
}
function row(id: number) {
  return db.select().from(backupLogs).where(eq(backupLogs.id, id)).get()!
}

describe('startBackupRun', () => {
  it('成功：completed、檔名、600、manifest、staging 已清、鎖已清', async () => {
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())
    expect(r.jobMetaId).toBe('job-1')
    expect(isBackupRunning()).toBe(true) // 同步上鎖
    expect(isBackupOrRestoreBusy()).toBe(true)
    await done
    const log = row(r.logId)
    expect(log.status).toBe('completed')
    expect(log.error).toBeNull()
    expect(path.basename(log.filePath!)).toBe('mcc-backup_openclaw_host1_20261006_120000.tar.gz')
    expect(path.dirname(log.filePath!)).toBe(outDir)
    expect(fs.statSync(log.filePath!).mode & 0o777).toBe(0o600)
    expect(log.fileSize).toBe(fs.statSync(log.filePath!).size)
    const m = parseManifest(JSON.parse(manifestAtTar!))
    expect(m.backend).toBe('openclaw')
    expect(m.backendVersion).toBe('2026.9.8')
    expect(m.mccVersion).toBe('0.3.94')
    expect(m.hostname).toBe('host1')
    expect(m.parts).toEqual({ backend: 'oc-backup.tar.gz', mccDb: 'mcc.sqlite', mccEnv: 'mcc.env' })
    expect(stagingAtTar).toEqual(['manifest.json', 'mcc.env', 'mcc.sqlite', 'oc-backup.tar.gz'])
    expect(leftovers()).toEqual([])
    expect(fs.readdirSync(outDir)).toEqual([path.basename(log.filePath!)])
    expect(isBackupRunning()).toBe(false)
  })

  it('.env.local 不存在：manifest.parts.mccEnv 為 null', async () => {
    startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({ copyEnvFile: () => false }))
    await done
    expect(parseManifest(JSON.parse(manifestAtTar!)).parts.mccEnv).toBeNull()
    expect(stagingAtTar).not.toContain('mcc.env')
  })

  it('不含 OpenClaw：不呼叫 create，仍有 MCC 部分', async () => {
    addJob({ includeOpenClaw: 0 })
    const r = startBackupRun({ jobId: 'j1', triggeredBy: 'api' }, makeDeps())
    await done
    expect(calls).not.toContain('openclaw')
    expect(calls).toContain('snapshot')
    expect(row(r.logId).status).toBe('completed')
    expect(stagingAtTar).toEqual(['manifest.json', 'mcc.env', 'mcc.sqlite'])
    const m = parseManifest(JSON.parse(manifestAtTar!))
    expect(m.backendVersion).toBeNull()
    expect(m.parts.backend).toBeNull()
    expect(leftovers()).toEqual([])
  })

  it('OpenClaw 失敗：failed、error 含 phase 名、無最終檔、無 staging、鎖已清', async () => {
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      openclawCreate: async () => { throw new Error('boom') },
    }))
    await done
    const log = row(r.logId)
    expect(log.status).toBe('failed')
    expect(log.error).toContain('openclaw backup create')
    expect(log.error).toContain('boom')
    expect(log.completedAt).not.toBeNull()
    expect(fs.readdirSync(outDir)).toEqual([])
    expect(isBackupRunning()).toBe(false)
    expect(calls).not.toContain('tar')
  })

  it('tar 失敗：刪除暫存封存檔與 staging', async () => {
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      tar: async (args) => { fs.writeFileSync(args[1], 'partial'); throw new Error('disk full') },
    }))
    await done
    expect(row(r.logId).status).toBe('failed')
    expect(row(r.logId).error).toContain('package archive')
    expect(fs.readdirSync(outDir)).toEqual([])
    expect(isBackupRunning()).toBe(false)
  })

  it('extra 失敗只是警告：主封存檔保留、row completed、warning 在 error', async () => {
    db.insert(backupSources).values({ id: 's1', name: 'gone', path: tmp }).run()
    db.insert(backupSources).values({ id: 's2', name: 'ok', path: tmp }).run()
    let n = 0
    const r = startBackupRun({ destinationId: 'd1', sourceIds: ['s1', 's2'], triggeredBy: 'api' }, makeDeps({
      runExtraBackup: async (_p, dir, name) => {
        if (n++ === 0) throw new Error('no dir')
        const fp = path.join(dir, `extra-backup_${name}_1.tar.gz`); fs.writeFileSync(fp, 'x')
        return { filename: 'e', size: 1, sizeHuman: '1 B', filePath: fp, warning: 'changed' }
      },
    }))
    await done
    const log = row(r.logId)
    expect(log.status).toBe('completed')
    expect(fs.existsSync(log.filePath!)).toBe(true)
    expect(log.error).toContain('gone')
    expect(log.error).toContain('no dir')
    expect(log.error).toContain('changed')
    expect(JSON.parse(log.extraFilePaths!)).toEqual([path.join(outDir, 'extra-backup_ok_1.tar.gz')])
    expect(leftovers()).toEqual([])
    expect(isBackupRunning()).toBe(false)
  })

  it('extra 成功：記錄 extraFilePaths，warning 寫入 completed 的 error', async () => {
    db.insert(backupSources).values({ id: 's1', name: 'src', path: tmp }).run()
    const r = startBackupRun({ destinationId: 'd1', sourceIds: ['s1'], triggeredBy: 'api' }, makeDeps({
      runExtraBackup: async (_p, dir) => {
        const fp = path.join(dir, 'extra-backup_src_1.tar.gz'); fs.writeFileSync(fp, 'x')
        return { filename: 'e', size: 1, sizeHuman: '1 B', filePath: fp, warning: 'file changed' }
      },
    }))
    await done
    const log = row(r.logId)
    expect(log.status).toBe('completed')
    expect(log.error).toBe('file changed')
    expect(JSON.parse(log.extraFilePaths!)).toEqual([path.join(outDir, 'extra-backup_src_1.tar.gz')])
  })

  it('FTP 上傳外層封存檔；上傳失敗讓 job failed 但保留本機檔', async () => {
    db.update(backupDestinations).set({ type: 'ftp', config: JSON.stringify({ ip: '1.2.3.4', port: 21, user: 'u', password: 'p', mode: 'passive', path: '/b' }) }).where(eq(backupDestinations.id, 'd1')).run()
    const uploaded: string[] = []
    // 先成功
    const deps = makeDeps({ uploadToFtp: async (f) => { uploaded.push(f) } })
    const r1 = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, deps)
    await done
    const log1 = row(r1.logId)
    expect(log1.status).toBe('completed')
    expect(uploaded).toEqual([log1.filePath])
    // 再失敗：保留本機封存檔
    fs.rmSync(log1.filePath!)
    const r2 = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      uploadToFtp: async () => { throw new Error('530 login') },
    }))
    await done
    const log2 = row(r2.logId)
    expect(log2.status).toBe('failed')
    expect(log2.error).toContain('upload')
    expect(log2.error).toContain('530 login')
    expect(log2.error).toContain(log2.filePath!)
    expect(fs.existsSync(log2.filePath!)).toBe(true)
    expect(log2.fileSize).toBe(fs.statSync(log2.filePath!).size)
    expect(leftovers()).toEqual([])
    expect(isBackupRunning()).toBe(false)
  })

  it('保留數：刪除非預設目的地目錄中最舊的檔，retention 失敗不會讓備份變 failed', async () => {
    addJob({ retainCount: 1 })
    const oldFile = path.join(outDir, 'mcc-backup_openclaw_host1_20200101_000000.tar.gz')
    const oldExtra = path.join(outDir, 'extra-backup_src_old.tar.gz')
    fs.writeFileSync(oldFile, 'o'); fs.writeFileSync(oldExtra, 'o')
    db.insert(backupLogs).values({
      jobId: 'j1', status: 'completed', startedAt: 1000, filePath: oldFile, extraFilePaths: JSON.stringify([oldExtra]),
    }).run()
    const r = startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, makeDeps())
    await done
    expect(row(r.logId).status).toBe('completed')
    expect(fs.existsSync(oldFile)).toBe(false)
    expect(fs.existsSync(oldExtra)).toBe(false)
    const old = db.select().from(backupLogs).where(eq(backupLogs.filePath, oldFile)).get()!
    expect(old.status).toBe('canceled')
    expect(isBackupRunning()).toBe(false)
  })

  it('保留數：刪檔丟錯只記警告，備份仍 completed，其他舊檔照刪', async () => {
    addJob({ retainCount: 1 })
    const outside = path.join(tmp, 'elsewhere', 'mcc-backup_x.tar.gz') // 不在任何備份目錄
    fs.mkdirSync(path.dirname(outside))
    fs.writeFileSync(outside, 'o')
    const okOld = path.join(outDir, 'mcc-backup_openclaw_host1_20200102_000000.tar.gz')
    fs.writeFileSync(okOld, 'o')
    db.insert(backupLogs).values({ jobId: 'j1', status: 'completed', startedAt: 1000, filePath: outside }).run()
    db.insert(backupLogs).values({ jobId: 'j1', status: 'completed', startedAt: 1001, filePath: okOld }).run()
    const r = startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, makeDeps())
    await done
    expect(row(r.logId).status).toBe('completed')
    expect(fs.existsSync(outside)).toBe(true) // 被拒絕刪除
    expect(fs.existsSync(okOld)).toBe(false)
    const oRow = db.select().from(backupLogs).where(eq(backupLogs.filePath, outside)).get()!
    expect(oRow.status).toBe('completed') // 檔案仍在，紀錄仍指向它
    expect(db.select().from(backupLogs).where(eq(backupLogs.id, 2)).get()!.status).toBe('canceled')
    expect(isBackupRunning()).toBe(false)
  })

  it('找不到 job：丟錯且不上鎖、不建 log', () => {
    expect(() => startBackupRun({ jobId: 'nope', triggeredBy: 'api' }, makeDeps())).toThrow(/not found/i)
    expect(isBackupRunning()).toBe(false)
    expect(db.select().from(backupLogs).all()).toEqual([])
  })

  it('startJob 同步丟錯：log failed 且鎖已清', () => {
    expect(() => startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      startJob: () => { throw new Error('no job store') },
    }))).toThrow('no job store')
    expect(isBackupRunning()).toBe(false)
    expect(db.select().from(backupLogs).all()[0].status).toBe('failed')
  })

  it('真實 tar：外層封存檔可解開且含 manifest', async () => {
    const real = makeDeps()
    delete (real as Partial<BackupRunDeps>).tar
    const { defaultTar } = await import('@/lib/backup/run-backup')
    startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, { ...real, tar: defaultTar })
    await done
    const f = fs.readdirSync(outDir)[0]
    const list = execFileSync('tar', ['tzf', path.join(outDir, f)]).toString()
    expect(list).toContain('manifest.json')
    expect(list).toContain('mcc.sqlite')
  })

  it('部分刪除：主檔已刪、extra 刪不掉 → 只寫回剩餘路徑、row 仍 completed', async () => {
    addJob({ retainCount: 1 })
    const mainOld = path.join(outDir, 'mcc-backup_openclaw_host1_20200103_000000.tar.gz')
    fs.writeFileSync(mainOld, 'o')
    const stray = path.join(tmp, 'elsewhere2', 'extra-backup_z.tar.gz')
    fs.mkdirSync(path.dirname(stray)); fs.writeFileSync(stray, 'o')
    db.insert(backupLogs).values({ jobId: 'j1', status: 'completed', startedAt: 1000, filePath: mainOld, extraFilePaths: JSON.stringify([stray]) }).run()
    startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, makeDeps())
    await done
    const o = db.select().from(backupLogs).where(eq(backupLogs.id, 1)).get()!
    expect(o.status).toBe('completed')
    expect(o.filePath).toBeNull()
    expect(JSON.parse(o.extraFilePaths!)).toEqual([stray])
    expect(fs.existsSync(mainOld)).toBe(false)
  })

  it('保留數只計同 job 的 completed：failed 與其他 job 的紀錄不算也不刪', async () => {
    addJob({ retainCount: 2 })
    const mk = (n: string) => { const f = path.join(outDir, n); fs.writeFileSync(f, 'o'); return f }
    const prev = mk('mcc-backup_openclaw_h_1.tar.gz')
    const failedF = mk('mcc-backup_openclaw_h_2.tar.gz')
    const otherF = mk('mcc-backup_openclaw_h_3.tar.gz')
    db.insert(backupLogs).values({ jobId: 'j1', status: 'completed', startedAt: 1000, filePath: prev }).run()
    db.insert(backupLogs).values({ jobId: 'j1', status: 'failed', startedAt: 1001, filePath: failedF }).run()
    db.insert(backupLogs).values({ jobId: 'other', status: 'completed', startedAt: 1002, filePath: otherF }).run()
    startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, makeDeps())
    await done
    // j1 completed 共 2 筆（prev + 本次）= retain，什麼都不刪
    expect(fs.existsSync(prev)).toBe(true)
    expect(fs.existsSync(failedF)).toBe(true)
    expect(fs.existsSync(otherF)).toBe(true)
  })

  it('BackupBusyError：執行中再啟動會丟錯且不建第二筆 row', async () => {
    startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())
    expect(() => startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())).toThrow(BackupBusyError)
    expect(db.select().from(backupLogs).all()).toHaveLength(1)
    await done
    expect(isBackupRunning()).toBe(false)
  })

  it('重啟類 job 進行中：拒絕啟動備份、不建 row、不上鎖', () => {
    const job = { id: 'j', kind: 'upgrade-mcc', label: 'Upgrade MCC', status: 'running' } as never
    expect(() => startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({ findBlockingJob: () => job })))
      .toThrow(/Upgrade MCC/)
    expect(db.select().from(backupLogs).all()).toHaveLength(0)
    expect(isBackupRunning()).toBe(false)
  })

  it('I1：logger 一直丟錯，仍解鎖、row 不停在 processing、暫存清掉', async () => {
    logger = () => { throw new Error('ENOSPC') }
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      tar: async (args) => { fs.writeFileSync(args[1], 'partial'); throw new Error('disk full') },
    }))
    await done
    expect(row(r.logId).status).toBe('failed')
    expect(row(r.logId).error).toContain('disk full')
    expect(isBackupRunning()).toBe(false)
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('I1：runner 在 phase 之間丟錯（沒跑到 retention）→ onSettled 保底：解鎖、failed、保留最終檔', async () => {
    runnerThrowsAfter = 2 // package 之後、record result 之前中斷
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())
    await done
    const log = row(r.logId)
    expect(log.status).toBe('failed')
    expect(log.error).toContain('job runner')
    expect(log.error).toContain(log.filePath!) // 已 rename 的最終檔是有效資料：保留並在 error 指出路徑
    expect(fs.existsSync(log.filePath!)).toBe(true)
    expect(log.fileSize).toBe(fs.statSync(log.filePath!).size)
    expect(isBackupRunning()).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('runner 中斷發生在 completed 之後：row 維持 completed，仍解鎖', async () => {
    runnerThrowsAfter = 3 // record result 之後、retention 之前
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())
    await done
    expect(row(r.logId).status).toBe('completed')
    expect(isBackupRunning()).toBe(false)
    expect(fs.existsSync(row(r.logId).filePath!)).toBe(true)
  })

  it('M1：計算階段丟錯（hostname）也不洩漏鎖或 row', () => {
    expect(() => startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      hostname: () => { throw new Error('no hostname') },
    }))).toThrow('no hostname')
    expect(isBackupRunning()).toBe(false)
    expect(db.select().from(backupLogs).all()).toEqual([])
  })

  it('M4：tar 參數含 --force-local；輸出目錄被 resolve（相對路徑不跟 cwd）', async () => {
    let args: string[] = []
    const rel = path.relative(process.cwd(), outDir)
    db.update(backupDestinations).set({ config: JSON.stringify({ path: rel }) }).where(eq(backupDestinations.id, 'd1')).run()
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      tar: async (a) => { args = a; fs.writeFileSync(a[1], 'x') },
    }))
    await done
    expect(args).toContain('--force-local')
    expect(row(r.logId).filePath).toBe(path.join(outDir, path.basename(row(r.logId).filePath!)))
  })

  it('D：tar 寫入私有 0700 目錄（不是 staging、不在最終名稱），封存檔 rename 前已是 600', async () => {
    let tarDirMode = 0
    let tarDir = ''
    let stagingDir = ''
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      tar: async (a) => {
        tarDir = path.dirname(a[1]); stagingDir = a[a.indexOf('-C') + 1]
        tarDirMode = fs.statSync(tarDir).mode & 0o777
        fs.writeFileSync(a[1], 'x')
      },
    }))
    await done
    expect(tarDirMode).toBe(0o700)
    expect(tarDir).not.toBe(stagingDir)
    expect(path.dirname(tarDir)).toBe(outDir)
    expect(fs.statSync(row(r.logId).filePath!).mode & 0o777).toBe(0o600)
  })

  it('D：staging 目錄為 0700', async () => {
    let mode = 0
    startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      tar: async (a) => { mode = fs.statSync(a[a.indexOf('-C') + 1]).mode & 0o777; fs.writeFileSync(a[1], 'x') },
    }))
    await done
    expect(mode).toBe(0o700)
  })

  it('C：每次執行開頭清掉上次中斷留下的 staging / tmp / partial', async () => {
    fs.mkdirSync(path.join(outDir, '.mcc-backup-staging-1'))
    fs.writeFileSync(path.join(outDir, '.mcc-backup-staging-1', 'mcc.env'), 'SECRET')
    fs.mkdirSync(path.join(outDir, '.mcc-backup-tmp-abc'))
    fs.writeFileSync(path.join(outDir, '.mcc-backup-x.partial'), 'p')
    fs.writeFileSync(path.join(outDir, 'unrelated.txt'), 'keep')
    startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps())
    await done
    expect(leftovers()).toEqual([])
    expect(fs.existsSync(path.join(outDir, 'unrelated.txt'))).toBe(true)
  })

  it('M6：OpenClaw 封存檔不在 staging 內 → phase 失敗並刪除該檔', async () => {
    const stray = path.join(tmp, 'stray-oc.tar.gz')
    fs.writeFileSync(stray, 'oc')
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      openclawCreate: async () => ({ archivePath: stray, version: '1', warnings: [] }),
    }))
    await done
    expect(row(r.logId).status).toBe('failed')
    expect(row(r.logId).error).toContain('openclaw backup create')
    expect(fs.existsSync(stray)).toBe(false)
  })

  it('extra 檔案以私有目錄產生後才搬到輸出目錄（寫入時不在 outDir 內）', async () => {
    db.insert(backupSources).values({ id: 's1', name: 'src', path: tmp }).run()
    let writeDirMode = 0
    let writeDir = ''
    startBackupRun({ destinationId: 'd1', sourceIds: ['s1'], triggeredBy: 'api' }, makeDeps({
      runExtraBackup: async (_p, dir) => {
        writeDir = dir; writeDirMode = fs.statSync(dir).mode & 0o777
        const fp = path.join(dir, 'extra-backup_src_1.tar.gz'); fs.writeFileSync(fp, 'x')
        return { filename: 'e', size: 1, sizeHuman: '1 B', filePath: fp }
      },
    }))
    await done
    expect(writeDirMode).toBe(0o700)
    expect(writeDir).not.toBe(outDir)
    expect(fs.existsSync(path.join(outDir, 'extra-backup_src_1.tar.gz'))).toBe(true)
  })

  it('真實 startJob（tmp MISSION_CONTROL_DATA_DIR）：跑完整流程並解鎖', async () => {
    const real = makeDeps()
    const r = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, { ...real, startJob })
    for (let i = 0; i < 100 && isBackupRunning(); i++) await new Promise((res) => setTimeout(res, 20))
    expect(isBackupRunning()).toBe(false)
    expect(row(r.logId).status).toBe('completed')
    expect(fs.existsSync(path.join(h.dataDir, 'jobs', 'index.jsonl'))).toBe(true)
  })
})

describe('reconcileStaleBackupLogs', () => {
  it('processing 一律改 failed 並寫中斷訊息，其他狀態不動', () => {
    db.insert(backupLogs).values({ status: 'processing' }).run()
    db.insert(backupLogs).values({ status: 'completed' }).run()
    db.insert(backupLogs).values({ status: 'processing' }).run()
    expect(reconcileStaleBackupLogs(db)).toBe(2)
    const rows = db.select().from(backupLogs).all()
    expect(rows.map((x) => x.status)).toEqual(['failed', 'completed', 'failed'])
    expect(rows[0].error).toBe(STALE_PROCESSING_ERROR)
    expect(rows[0].completedAt).not.toBeNull()
    expect(rows[1].error).toBeNull()
  })
})
