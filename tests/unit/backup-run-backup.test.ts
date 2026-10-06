import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// 記憶體 DB 取代 @/lib/db，絕不碰 ~/.mission-control
const h = vi.hoisted(() => ({ holder: {} as { db?: unknown } }))
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
import { startBackupRun, type BackupRunDeps } from '@/lib/backup/run-backup'
import { parseManifest } from '@/lib/backup/archive-format'
import { isBackupRunning, isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/scripts'
import type { JobSpec } from '@/lib/jobs/runner'

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
let db: ReturnType<typeof makeDb>
let done: Promise<void>
let calls: string[]
let manifestAtTar: string | null
let stagingAtTar: string[]

function fakeStartJob(spec: JobSpec) {
  done = (async () => {
    for (const p of spec.phases) {
      let code = 0
      try { code = await p.inline!(() => {}, { setExpectedVersion() {}, setExtra() {} }) } catch { code = 1 }
      if (code !== 0 && !p.allowFailure) break
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
  db.insert(backupDestinations).values({ id: 'd1', name: 'Local', type: 'local', config: JSON.stringify({ path: outDir }) }).run()
})
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
    expect(m.parts.backend).toBe('(not-included)')
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

  it('extra 失敗：整個備份 failed，已寫出的外層封存檔被移除', async () => {
    db.insert(backupSources).values({ id: 's1', name: 'src', path: tmp }).run()
    const r = startBackupRun({ destinationId: 'd1', sourceIds: ['s1'], triggeredBy: 'api' }, makeDeps({
      runExtraBackup: async () => { throw new Error('no dir') },
    }))
    await done
    expect(row(r.logId).status).toBe('failed')
    expect(row(r.logId).error).toContain('extra folders')
    expect(fs.readdirSync(outDir)).toEqual([])
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

  it('FTP 上傳外層封存檔；上傳失敗讓 job failed 且不留檔', async () => {
    db.update(backupDestinations).set({ type: 'ftp', config: JSON.stringify({ ip: '1.2.3.4', port: 21, user: 'u', password: 'p', mode: 'passive', path: '/b' }) }).where(eq(backupDestinations.id, 'd1')).run()
    const uploaded: string[] = []
    // 先成功
    const deps = makeDeps({ uploadToFtp: async (f) => { uploaded.push(f) } })
    const r1 = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, deps)
    await done
    const log1 = row(r1.logId)
    expect(log1.status).toBe('completed')
    expect(uploaded).toEqual([log1.filePath])
    // 再失敗
    fs.rmSync(log1.filePath!)
    const r2 = startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, makeDeps({
      uploadToFtp: async () => { throw new Error('530 login') },
    }))
    await done
    expect(row(r2.logId).status).toBe('failed')
    expect(row(r2.logId).error).toContain('upload')
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
})
