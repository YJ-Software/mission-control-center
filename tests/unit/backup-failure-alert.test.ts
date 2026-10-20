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
// 通知中心：預設寫進記憶體 DB 的 notifications 表（與真的 createNotification 一樣留下 dedup_key）並記錄；
// 個別測試可換成會丟錯的版本
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
import { STALE_PROCESSING_ERROR } from '@/lib/backup/reconcile'

const { backupLogs, backupJobs, backupDestinations } = backupSchema

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination_id TEXT NOT NULL, schedule_id TEXT NOT NULL, retain_count INTEGER NOT NULL DEFAULT 7, source_ids TEXT NOT NULL DEFAULT '[]', include_openclaw INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, cron_job_id TEXT, model TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending', started_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER, file_size INTEGER, file_path TEXT, extra_file_paths TEXT, destination TEXT, notes TEXT, error TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, body TEXT, link TEXT, dedup_key TEXT, created_at INTEGER DEFAULT (unixepoch()), read_at INTEGER);
  `)
  return drizzle(sqlite, { schema: { ...appSchema, ...backupSchema } })
}

type Notice = { type: string; severity?: string; title: string; body?: string; link?: string; dedupKey?: string }

let db: ReturnType<typeof makeDb>
let notices: Notice[]
let noticeSeq = 0

function recordNotice(input: unknown) {
  const n = input as Notice
  notices.push(n)
  db.insert(appSchema.notifications).values({
    id: `n${++noticeSeq}`, type: n.type, severity: n.severity ?? 'info', title: n.title,
    body: n.body ?? null, link: n.link ?? null, dedupKey: n.dedupKey ?? null,
  }).run()
  return null
}

beforeEach(() => {
  db = makeDb()
  h.holder.db = db
  notices = []
  h.notify.fn = recordNotice
  db.insert(backupJobs).values({ id: 'j1', name: '每日備份', destinationId: 'd1', scheduleId: 's1', retainCount: 0 }).run()
})
afterAll(() => { fs.rmSync(h.dataDir, { recursive: true, force: true }) })

// --- 純邏輯 ---

describe('summarizeBackupStreak / decideBackupAlert', () => {
  let seq = 100
  const f = (error = 'boom') => ({ id: seq--, status: 'failed', error, completedAt: 100 })
  const ok = (completedAt = 50) => ({ id: seq--, status: 'completed', error: null, completedAt })
  beforeEach(() => { seq = 100 })

  it('從最新往回數連續 failed，遇到成功就停；processing 不算；streakStartId 是本輪最早那筆失敗', () => {
    const s = summarizeBackupStreak([f('最新'), { id: seq--, status: 'processing', error: null, completedAt: null }, f(), ok(42), f(), f()])
    expect(s).toMatchObject({ latest: 'failed', latestId: 100, failures: 2, streakStartId: 98, lastError: '最新', lastSuccessAt: 42 })
  })

  it('retention 刪掉檔案後的 canceled 是過去的成功，會中斷連續失敗並提供最後成功時間', () => {
    const s = summarizeBackupStreak([f(), { id: seq--, status: 'canceled', error: null, completedAt: 77 }, f(), f(), f()])
    expect(s).toMatchObject({ latest: 'failed', failures: 1, lastSuccessAt: 77 })
  })

  it('最新是成功：priorFailures 與 streakStartId 指向它之前那段連續失敗', () => {
    const s = summarizeBackupStreak([ok(90), f(), f(), f(), f(), ok(10)])
    expect(s).toMatchObject({ latest: 'success', latestId: 100, failures: 0, priorFailures: 4, streakStartId: 96, lastSuccessAt: 90 })
  })

  it('完成但有警告（completed + error）是成功', () => {
    const s = summarizeBackupStreak([{ id: seq--, status: 'completed', error: 'extra 失敗', completedAt: 5 }, f(), f(), f()])
    expect(s).toMatchObject({ latest: 'success', priorFailures: 3 })
  })

  const failing = (n: number, lastAlerted: number | null) =>
    decideBackupAlert({ latest: 'failed', latestId: 1, failures: n, priorFailures: 0, streakStartId: 1, lastError: 'x', lastSuccessAt: null }, lastAlerted)

  it('門檻是「達到」不是「剛好等於」：本輪尚未告警時，1、2 不通知，≥ 3 就通知', () => {
    expect(failing(1, null)).toBeNull()
    expect(failing(2, null)).toBeNull()
    expect(failing(3, null)).toEqual({ kind: 'failing', count: 3 })
    expect(failing(4, null)).toEqual({ kind: 'failing', count: 4 })
    expect(failing(86, null)).toEqual({ kind: 'failing', count: 86 })
  })

  it('本輪已告警過：距上次告警滿 12 次才再通知', () => {
    expect(failing(4, 3)).toBeNull()
    expect(failing(14, 3)).toBeNull()
    expect(failing(15, 3)).toEqual({ kind: 'failing', count: 15 })
    expect(failing(97, 86)).toBeNull()
    expect(failing(98, 86)).toEqual({ kind: 'failing', count: 98 })
  })

  it('成功：前段曾真的發過告警才發已恢復（不由次數推測）', () => {
    const rec = (n: number, lastAlerted: number | null) =>
      decideBackupAlert({ latest: 'success', latestId: 1, failures: 0, priorFailures: n, streakStartId: 1, lastError: null, lastSuccessAt: 1 }, lastAlerted)
    expect(rec(0, null)).toBeNull()
    expect(rec(2, null)).toBeNull()
    expect(rec(5, null)).toBeNull()
    expect(rec(3, 3)).toEqual({ kind: 'recovered', count: 3 })
    expect(rec(85, 75)).toEqual({ kind: 'recovered', count: 85 })
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

  it('內容：job 名稱、連續次數、單行 body（次數｜最後成功｜錯誤前 120 字）、系統紀錄連結', () => {
    const long = '甲'.repeat(250)
    addLog('failed'); addLog('failed')
    const logId = addLog('failed', { error: long })
    notifyBackupOutcome({ jobId: 'j1', logId, runJobId: 'run-abc' })
    expect(notices).toHaveLength(1)
    const n = notices[0]
    expect(n.title).toContain('每日備份')
    expect(n.title).toContain('3')
    // 鈴鐺清單是 line-clamp-2、無 pre-line：單行，次數與最後成功在錯誤之前
    expect(n.body).not.toMatch(/\n/)
    expect(n.body).toBe(`連續失敗 3 次｜從未成功｜${'甲'.repeat(120)}…`)
    expect(n.link).toBe('/system-log?tab=jobs&job=run-abc')
  })

  it('內容：有過成功時寫出最後成功時間', () => {
    const okAt = Math.floor(new Date(2026, 9, 12, 8, 5).getTime() / 1000)
    addLog('completed', { completedAt: okAt })
    addLog('failed'); addLog('failed')
    const logId = addLog('failed', { error: 'upload: 530 Login incorrect' })
    notifyBackupOutcome({ jobId: 'j1', logId, runJobId: 'r' })
    expect(notices[0].body).toBe(`連續失敗 3 次｜最後成功 ${formatAlertTime(okAt)}｜upload: 530 Login incorrect`)
  })

  it('錯誤訊息的換行與連續空白壓成單一空白', () => {
    addLog('failed'); addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed', { error: 'tar failed:\n  line2\n\nline3' }), runJobId: 'r' })
    expect(notices[0].body).toBe('連續失敗 3 次｜從未成功｜tar failed: line2 line3')
  })

  it('部署時已連續失敗 85 次：下一次失敗立即告警一次；之後 11 次不告警、第 12 次再告警', () => {
    for (let i = 0; i < 85; i++) addLog('failed')
    const fired: number[] = []
    for (let k = 1; k <= 13; k++) {
      const before = notices.length
      notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
      if (notices.length > before) fired.push(k)
    }
    expect(fired).toEqual([1, 13])
    expect(notices[0].title).toContain('86')
    expect(notices[1].title).toContain('98')
  })

  it('開機 reconcile 把第 3 次補成 failed（沒經過告警）：第 4 次失敗立即補發', () => {
    addLog('failed'); notifyBackupOutcome({ jobId: 'j1', logId: 1, runJobId: 'r' })
    addLog('failed'); notifyBackupOutcome({ jobId: 'j1', logId: 2, runJobId: 'r' })
    addLog('failed', { error: STALE_PROCESSING_ERROR }) // reconcile 寫入，不呼叫告警
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toContain('4')
  })

  it('告警本身送出失敗：下一次失敗補發，不會等到第 15 次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    addLog('failed'); addLog('failed')
    h.notify.fn = () => { throw new Error('bell down') }
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    h.notify.fn = recordNotice
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
    expect(notices[0].title).toContain('4')
    warn.mockRestore()
  })

  it('告警帶穩定標記：dedupKey 含 job id、本輪起點 log id、當時次數', () => {
    addLog('completed')
    const start = addLog('failed'); addLog('failed')
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices[0].dedupKey).toBe(`backup-failing:j1:${start}:3`)
  })

  it('不同輪的告警不互相影響：上一輪告警過，新一輪仍在第 3 次告警', () => {
    for (let i = 0; i < 3; i++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('completed'), runJobId: 'r' })
    expect(notices).toHaveLength(2)
    for (let i = 0; i < 3; i++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(3)
    expect(notices[2].title).toContain('3')
  })

  it('連續失敗達 3 次但當時沒告警成功：成功時不發沒有對應告警的「已恢復」', () => {
    for (let i = 0; i < 4; i++) addLog('failed') // 例如部署前累積、或 reconcile 補的
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('completed'), runJobId: 'r' })
    expect(notices).toHaveLength(0)
  })

  it('本次 row 沒寫成最終狀態（仍是 processing）：不用上一筆判斷、不重發', () => {
    for (let i = 0; i < 3; i++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
    db.delete(appSchema.notifications).run() // 即使上一則告警被刪掉，也不可拿上一筆來發
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('processing'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
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
    for (let i = 0; i < 4; i++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(1)
    const okAt = Math.floor(new Date(2026, 9, 21, 2, 0).getTime() / 1000)
    const okId = addLog('completed', { completedAt: okAt })
    notifyBackupOutcome({ jobId: 'j1', logId: okId, runJobId: 'run-ok' })
    expect(notices).toHaveLength(2)
    expect(notices[1].severity).toBe('info')
    expect(notices[1].title).toContain('已恢復')
    expect(notices[1].body).toBe(`連續失敗 4 次後恢復｜本次成功 ${formatAlertTime(okAt)}`)
    expect(notices[1].link).toBe('/system-log?tab=jobs&job=run-ok')

    for (let n = 1; n <= 2; n++) notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(2)
    notifyBackupOutcome({ jobId: 'j1', logId: addLog('failed'), runJobId: 'r' })
    expect(notices).toHaveLength(3)
    expect(notices[2].severity).toBe('error')
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

  it('startJob 同步丟錯（沒有 runner job id）：仍計入並告警，連結退回工作列表', async () => {
    await runOnce(); await runOnce()
    const throwing = { ...deps(), startJob: () => { throw new Error('job store 寫不進去') } }
    expect(() => startBackupRun({ jobId: 'j1', triggeredBy: 'cron' }, throwing)).toThrow('job store 寫不進去')
    expect(notices).toHaveLength(1)
    expect(notices[0].link).toBe('/system-log?tab=jobs')
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('不屬於任何 job 的手動備份不觸發告警', async () => {
    for (let i = 0; i < 3; i++) {
      startBackupRun({ destinationId: 'd1', triggeredBy: 'api' }, deps())
      await done
    }
    expect(notices).toHaveLength(0)
  })
})
