import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

// 安全閥：本檔所有備份執行都走注入的 deps（tar、openclawCreate、startJob 全是假的）；
// 任何真的 spawn/exec 都要立刻失敗，絕不可對本機 openclaw / systemctl / tar 動手。
vi.mock('node:child_process', () => {
  const boom = () => { throw new Error('child_process must not be used in backup-failure-alert tests') }
  return { spawn: boom, exec: boom, execFile: boom, execSync: boom, execFileSync: boom, spawnSync: boom, default: {} }
})
vi.mock('child_process', () => {
  const boom = () => { throw new Error('child_process must not be used in backup-failure-alert tests') }
  return { spawn: boom, exec: boom, execFile: boom, execSync: boom, execFileSync: boom, spawnSync: boom, default: {} }
})

// 記憶體 DB 取代 @/lib/db，絕不碰 ~/.mission-control
const h = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  const dataDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-alert-jobs-'))
  process.env.MISSION_CONTROL_DATA_DIR = dataDir
  return { holder: {} as { db?: unknown }, dataDir, notify: { fn: null as null | ((i: unknown) => unknown) } }
})
vi.mock('@/lib/db', () => ({
  get db() { return h.holder.db },
  initDb: () => {},
  DB_PATH: '/nonexistent/db.sqlite',
}))
// 通知中心只記錄呼叫；個別測試可換成會丟錯的版本
vi.mock('@/lib/notifications', () => ({
  createNotification: (input: unknown) => h.notify.fn?.(input) ?? null,
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as appSchema from '@/lib/schema'
import * as backupSchema from '@/lib/backup/schema'
import {
  summarizeBackupStreak,
  decideBackupAlert,
  notifyBackupOutcome,
  formatAlertTime,
} from '@/lib/backup/failure-alert'
import { startBackupRun, type BackupRunDeps } from '@/lib/backup/run-backup'
import { isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/scripts'
import type { JobSpec } from '@/lib/jobs/runner'

const { backupLogs, backupJobs, backupDestinations } = backupSchema

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

type Notice = { type: string; severity?: string; title: string; body?: string; link?: string; dedupKey?: string }

let db: ReturnType<typeof makeDb>
let notices: Notice[]

beforeEach(() => {
  db = makeDb()
  h.holder.db = db
  notices = []
  h.notify.fn = (input) => { notices.push(input as Notice); return null }
  db.insert(backupJobs).values({ id: 'j1', name: '每日備份', destinationId: 'd1', scheduleId: 's1', retainCount: 0 }).run()
})
afterAll(() => { fs.rmSync(h.dataDir, { recursive: true, force: true }) })

// --- 純邏輯 ---

describe('summarizeBackupStreak / decideBackupAlert', () => {
  const f = (error = 'boom') => ({ status: 'failed', error, completedAt: 100 })
  const ok = (completedAt = 50) => ({ status: 'completed', error: null, completedAt })

  it('從最新往回數連續 failed，遇到成功就停；processing 不算', () => {
    const s = summarizeBackupStreak([f('最新'), { status: 'processing', error: null, completedAt: null }, f(), ok(42), f(), f()])
    expect(s).toMatchObject({ latest: 'failed', failures: 2, lastError: '最新', lastSuccessAt: 42 })
  })

  it('retention 刪掉檔案後的 canceled 是過去的成功，會中斷連續失敗並提供最後成功時間', () => {
    const s = summarizeBackupStreak([f(), { status: 'canceled', error: null, completedAt: 77 }, f(), f(), f()])
    expect(s).toMatchObject({ latest: 'failed', failures: 1, lastSuccessAt: 77 })
  })

  it('最新是成功：priorFailures 是它之前那段連續失敗', () => {
    const s = summarizeBackupStreak([ok(90), f(), f(), f(), f(), ok(10)])
    expect(s).toMatchObject({ latest: 'success', failures: 0, priorFailures: 4, lastSuccessAt: 90 })
  })

  it('完成但有警告（completed + error）是成功', () => {
    const s = summarizeBackupStreak([{ status: 'completed', error: 'extra 失敗', completedAt: 5 }, f(), f(), f()])
    expect(s).toMatchObject({ latest: 'success', priorFailures: 3 })
  })

  it('連續失敗 1、2 不通知；3 通知；4–14 不通知；15、27 再通知', () => {
    const at = (n: number) => decideBackupAlert({ latest: 'failed', failures: n, priorFailures: 0, lastError: 'x', lastSuccessAt: null })
    const alerted = Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => at(n) !== null)
    expect(alerted).toEqual([3, 15, 27, 39])
    expect(at(3)).toEqual({ kind: 'failing', count: 3 })
  })

  it('成功：此前連續失敗達 3 次（曾發告警）才發已恢復；未達 3 不通知', () => {
    const rec = (n: number) => decideBackupAlert({ latest: 'success', failures: 0, priorFailures: n, lastError: null, lastSuccessAt: 1 })
    expect(rec(0)).toBeNull()
    expect(rec(2)).toBeNull()
    expect(rec(3)).toEqual({ kind: 'recovered', count: 3 })
    expect(rec(85)).toEqual({ kind: 'recovered', count: 85 })
  })
})

// --- 讀 backup_logs 並送通知 ---

function addLog(status: string, extra: { error?: string | null; completedAt?: number | null; jobId?: string | null } = {}): number {
  return db.insert(backupLogs).values({
    jobId: extra.jobId === undefined ? 'j1' : extra.jobId,
    status,
    error: extra.error ?? null,
    completedAt: extra.completedAt ?? 1000,
  }).returning({ id: backupLogs.id }).get().id
}

describe('notifyBackupOutcome（以 backup_logs 為計數來源）', () => {
  it('逐次失敗：只在第 3 與第 15 次各發一則', () => {
    const fired: number[] = []
    for (let n = 1; n <= 15; n++) {
      const logId = addLog('failed', { error: `錯誤 ${n}` })
      const before = notices.length
      notifyBackupOutcome({ jobId: 'j1', logId, runJobId: `run-${n}` })
      if (notices.length > before) fired.push(n)
    }
    expect(fired).toEqual([3, 15])
    expect(notices[0].severity).toBe('error')
    expect(notices[0].type).toBe('backup')
  })

  it('內容：job 名稱、連續次數、錯誤前 200 字、從未成功、系統紀錄連結', () => {
    const long = '甲'.repeat(250)
    addLog('failed'); addLog('failed')
    const logId = addLog('failed', { error: long })
    notifyBackupOutcome({ jobId: 'j1', logId, runJobId: 'run-abc' })
    expect(notices).toHaveLength(1)
    const n = notices[0]
    expect(n.title).toContain('每日備份')
    expect(n.title).toContain('3')
    expect(n.body).toContain('甲'.repeat(200))
    expect(n.body).not.toContain('甲'.repeat(201))
    expect(n.body).toContain('從未成功')
    expect(n.link).toBe('/system-log?tab=jobs&job=run-abc')
  })

  it('內容：有過成功時寫出最後成功時間', () => {
    const okAt = Math.floor(new Date(2026, 9, 12, 8, 5).getTime() / 1000)
    addLog('completed', { completedAt: okAt })
    addLog('failed'); addLog('failed')
    const logId = addLog('failed', { error: 'upload: 530 Login incorrect' })
    notifyBackupOutcome({ jobId: 'j1', logId, runJobId: 'r' })
    expect(notices[0].body).toContain(formatAlertTime(okAt))
    expect(notices[0].body).toContain('upload: 530 Login incorrect')
    expect(notices[0].body).not.toContain('從未成功')
  })

  it('只計同一個 job：其他 job 與沒有 job 的手動備份失敗不累計', () => {
    db.insert(backupJobs).values({ id: 'j2', name: '另一個', destinationId: 'd1', scheduleId: 's1' }).run()
    addLog('failed'); addLog('failed', { jobId: 'j2' }); addLog('failed', { jobId: null }); addLog('failed')
    const logId = addLog('completed', { jobId: 'j2' })
    notifyBackupOutcome({ jobId: 'j2', logId, runJobId: 'r' })
    const last = addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: last, runJobId: 'r' })
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toContain('3')
  })

  it('不看比本次 logId 更新的紀錄（以本次執行的結果為準）', () => {
    addLog('failed'); addLog('failed')
    const logId = addLog('failed')
    addLog('completed')
    notifyBackupOutcome({ jobId: 'j1', logId, runJobId: 'r' })
    expect(notices).toHaveLength(1)
    expect(notices[0].severity).toBe('error')
  })

  it('成功後歸零並發「已恢復」；之後再失敗要重新累積到 3 才告警', () => {
    for (let i = 0; i < 4; i++) addLog('failed')
    const okId = addLog('completed', { completedAt: 2000 })
    notifyBackupOutcome({ jobId: 'j1', logId: okId, runJobId: 'run-ok' })
    expect(notices).toHaveLength(1)
    expect(notices[0].severity).toBe('info')
    expect(notices[0].title).toContain('已恢復')
    expect(notices[0].body).toContain('4')
    expect(notices[0].link).toBe('/system-log?tab=jobs&job=run-ok')

    for (let n = 1; n <= 2; n++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(2)
    expect(notices[1].severity).toBe('error')
  })

  it('成功前沒發過告警（只失敗 2 次）則成功不通知', () => {
    addLog('failed'); addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('completed'), runJobId: 'r' })
    expect(notices).toHaveLength(0)
  })

  it('沒有 runJobId 時連到系統紀錄的工作列表', () => {
    addLog('failed'); addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: null })
    expect(notices[0].link).toBe('/system-log?tab=jobs')
  })

  it('job 已被刪除：用 jobId 當名稱，仍通知', () => {
    db.delete(backupJobs).where(eq(backupJobs.id, 'j1')).run()
    addLog('failed'); addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices[0].title).toContain('j1')
  })

  it('通知函式丟錯：notifyBackupOutcome 不丟錯', () => {
    h.notify.fn = () => { throw new Error('notifications table locked') }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    addLog('failed'); addLog('failed')
    expect(() => notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

// --- 與 startBackupRun 的整合（排程與「立即執行」共用這條路） ---

describe('startBackupRun 結束時發告警', () => {
  let tmp: string
  let outDir: string
  let done: Promise<void>
  let failOpenClaw: boolean

  function fakeStartJob(spec: JobSpec) {
    done = (async () => {
      try {
        for (const p of spec.phases) {
          let code = 0
          try { code = await p.inline!(() => {}, { setExpectedVersion() {}, setExtra() {} }) } catch { code = 1 }
          if (code !== 0 && !p.allowFailure) break
        }
      } finally {
        spec.onSettled?.()
      }
    })()
    return { id: 'run-xyz' } as ReturnType<BackupRunDeps['startJob']>
  }

  function deps(): Partial<BackupRunDeps> {
    return {
      startJob: fakeStartJob,
      openclawCreate: async (dir) => {
        if (failOpenClaw) throw new Error('gateway 沒回應')
        const p = path.join(dir, 'oc.tar.gz')
        fs.writeFileSync(p, 'oc')
        return { archivePath: p, version: '2026.10.3', warnings: [] }
      },
      snapshotMccDb: async (_s, dest) => { fs.writeFileSync(dest, 'db', { mode: 0o600 }) },
      markSnapshotRow: () => {},
      copyEnvFile: () => false,
      tar: async (args) => { fs.writeFileSync(args[1], 'archive') },
      uploadToFtp: async () => {},
      runExtraBackup: async () => { throw new Error('unused') },
      now: () => new Date(),
      hostname: () => 'host1',
      mccVersion: () => '0.4.4',
      dbPath: '/nonexistent/db.sqlite',
      envPath: '/nonexistent/.env.local',
    }
  }

  async function runOnce() {
    startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, deps())
    await done
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-alert-run-'))
    outDir = path.join(tmp, 'out')
    fs.mkdirSync(outDir)
    db.insert(appSchema.settings).values({ key: 'backupOutputDir', value: outDir }).run()
    db.insert(backupDestinations).values({ id: 'd1', name: 'Local', type: 'local', config: JSON.stringify({ path: outDir }) }).run()
    setRunningLogId(null)
    failOpenClaw = true
  })
  afterEach(() => {
    setRunningLogId(null)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('連續失敗第 3 次發一則告警，連到本次執行的系統紀錄；之後成功發已恢復', async () => {
    await runOnce(); await runOnce()
    expect(notices).toHaveLength(0)
    await runOnce()
    expect(notices).toHaveLength(1)
    expect(notices[0].link).toBe('/system-log?tab=jobs&job=run-xyz')
    expect(notices[0].body).toContain('gateway 沒回應')

    failOpenClaw = false
    await runOnce()
    expect(db.select().from(backupLogs).all().at(-1)?.status).toBe('completed')
    expect(notices).toHaveLength(2)
    expect(notices[1].title).toContain('已恢復')
  })

  it('通知丟錯不影響備份結果：row 照記 failed、鎖已釋放、流程不丟錯', async () => {
    h.notify.fn = () => { throw new Error('bell down') }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runOnce(); await runOnce()
    await expect(runOnce()).resolves.toBeUndefined()
    const rows = db.select().from(backupLogs).all()
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('不屬於任何 job 的手動備份不觸發告警', async () => {
    for (let i = 0; i < 3; i++) {
      startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, deps())
      await done
    }
    expect(notices).toHaveLength(0)
  })
})
