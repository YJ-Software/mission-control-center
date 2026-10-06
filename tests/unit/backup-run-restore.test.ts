import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const h = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MISSION_CONTROL_DATA_DIR = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-jobs-data-'))
  return {}
})
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {}, DB_PATH: '/nonexistent/db.sqlite' }))

import { startRestore, describeBackup, defaultTar, type RestoreDeps } from '@/lib/backup/run-restore'
import { BackupBusyError } from '@/lib/backup/run-backup'
import { isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/scripts'
import type { JobSpec } from '@/lib/jobs/runner'

let tmp: string
let work: string
let calls: string[]
let spec: JobSpec | null
let done: Promise<void>
let logs: string[]
let extractedDirDuring: Record<string, boolean>

const dataDirs: string[] = []
afterAll(() => { for (const d of dataDirs) fs.rmSync(d, { recursive: true, force: true }) })

function tarReal(args: string[]) { return defaultTar(args) }

function buildArchive(opts: { backend?: string | null; env?: boolean } = {}) {
  const stage = fs.mkdtempSync(path.join(tmp, 'stage-'))
  const backend = opts.backend === undefined ? 'openclaw-backup.tar.gz' : opts.backend
  fs.writeFileSync(path.join(stage, 'mcc.sqlite'), 'sqlite-bytes')
  if (backend) fs.writeFileSync(path.join(stage, backend), 'oc-bytes')
  if (opts.env !== false) fs.writeFileSync(path.join(stage, 'mcc.env'), 'SECRET=1')
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({
    format: 1, backend: 'openclaw', backendVersion: '2026.9.8', mccVersion: '0.3.93',
    createdAt: '2026-10-06T00:00:00.000Z', hostname: 'h1',
    parts: { backend, mccDb: 'mcc.sqlite', mccEnv: opts.env !== false ? 'mcc.env' : null },
  }))
  const out = path.join(tmp, 'mcc-backup_openclaw_h1_20261006_000000.tar.gz')
  execFileSync('tar', ['czf', out, '-C', stage, '.'])
  return out
}

function fakeStartJob(s: JobSpec) {
  spec = s
  done = (async () => {
    try {
      for (const p of s.phases) {
        let code = 0
        try { code = await p.inline!((_st, t) => { logs.push(t) }, { setExpectedVersion() {}, setExtra() {} }) } catch { code = 1 }
        if (code !== 0) break
      }
    } finally { s.onSettled?.() }
  })()
  return { id: 'job-1' } as never
}

function deps(over: Partial<RestoreDeps> = {}): Partial<RestoreDeps> {
  return {
    startJob: fakeStartJob,
    tar: tarReal,
    openclawVerify: async () => { calls.push('verify-oc') },
    openclawRestore: async () => { calls.push('restore-oc'); return { preRestoreDir: '/pre', parkedSkillsDir: null } },
    stageDb: () => { calls.push('stage-db') },
    dbHealthy: () => true,
    scheduleRestart: (svc) => { calls.push(`restart:${svc}`) },
    getInstall: () => ({ mode: 'release', service: 'mission-control' }),
    mccVersion: () => '0.3.99',
    legacyRestore: async () => { calls.push('legacy'); return 'legacy ok' },
    legacyScriptsOk: () => true,
    now: () => new Date(1700000000000),
    dbPath: path.join(tmp, 'db.sqlite'),
    workRoot: work,
    ...over,
  }
}

const restoreDirs = () => fs.readdirSync(work).filter((n) => n.startsWith('.restore-'))

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-restore-test-'))
  work = path.join(tmp, 'state')
  calls = []; spec = null; logs = []; extractedDirDuring = {}
  setRunningLogId(null)
})
afterEach(() => { setRunningLogId(null); fs.rmSync(tmp, { recursive: true, force: true }) })

describe('startRestore mcc（release 模式）', () => {
  it('phase 名稱與順序、expectedVersion、restartingBeforeLastPhase', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps())
    expect(spec!.kind).toBe('backup-restore')
    expect(spec!.phases.map((p) => p.name)).toEqual(
      ['verify', 'extract', 'restore OpenClaw', 'stage MCC database', 'schedule MCC restart'])
    expect(spec!.expectedVersion).toBe('0.3.99')
    expect(spec!.restartingBeforeLastPhase).toBe(true)
    await done
    expect(calls).toEqual(['verify-oc', 'restore-oc', 'stage-db', 'restart:mission-control'])
  })

  it('成功後：解鎖、解壓目錄已移除；鎖在執行中是持有的', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps())
    expect(isBackupOrRestoreBusy()).toBe(true)
    await done
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('解壓目錄在 stage 之後、重啟之前就已移除，且為 0700 且在 workRoot 之下', async () => {
    const file = buildArchive()
    let mode = 0
    startRestore(file, 'api', deps({
      openclawVerify: async () => {
        const d = restoreDirs()
        expect(d.length).toBe(1)
        mode = fs.statSync(path.join(work, d[0])).mode & 0o777
      },
      scheduleRestart: () => { expect(restoreDirs()).toEqual([]); calls.push('restart') },
    }))
    await done
    expect(mode).toBe(0o700)
    expect(calls).toContain('restart')
  })

  it('backend 為 null：略過 OpenClaw 驗證與還原並記錄', async () => {
    const file = buildArchive({ backend: null })
    startRestore(file, 'api', deps())
    await done
    expect(calls).toEqual(['stage-db', 'restart:mission-control'])
    expect(logs.join('\n')).toContain('不含 OpenClaw 資料，略過')
  })

  it('OpenClaw 還原失敗：job 失敗、不 stage DB、不重啟、錯誤原文進 log、解鎖並清目錄', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({
      openclawRestore: async () => { throw new Error('Restore failed (x); rolled back. Previous data intact at /h/.openclaw.') },
    }))
    await done
    expect(calls).toEqual(['verify-oc'])
    expect(logs.join('\n')).toContain('Previous data intact at /h/.openclaw.')
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('OpenClaw verify 失敗：不會動現行資料', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ openclawVerify: async () => { throw new Error('bad archive') } }))
    await done
    expect(calls).toEqual([])
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('DB 快照不健康：在 OpenClaw 還原之前就中止', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ dbHealthy: () => false }))
    await done
    expect(calls).toEqual([])
    expect(logs.join('\n')).toContain('尚未更動任何現行資料')
    expect(restoreDirs()).toEqual([])
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('stage DB 失敗：失敗、不重啟、說明 OpenClaw 已還原、解鎖', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ stageDb: () => { throw new Error('disk full') } }))
    await done
    expect(calls).toEqual(['verify-oc', 'restore-oc'])
    expect(logs.join('\n')).toMatch(/disk full.*OpenClaw 資料已還原/)
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('排程重啟丟錯：仍解鎖', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ scheduleRestart: () => { throw new Error('spawn fail') } }))
    await done
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('runner 中途中斷（沒跑完 phase）：onSettled 保底解鎖並清目錄', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({
      startJob: (s) => {
        spec = s
        done = (async () => {
          await s.phases[0].inline!(() => {}, { setExpectedVersion() {}, setExtra() {} })
          await s.phases[1].inline!(() => {}, { setExpectedVersion() {}, setExtra() {} })
          s.onSettled?.() // runner 在第 3 個 phase 前死掉
        })()
        return { id: 'j' } as never
      },
    }))
    await done
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('startJob 同步丟錯：解鎖後再拋出', () => {
    const file = buildArchive()
    expect(() => startRestore(file, 'api', deps({ startJob: () => { throw new Error('boom') } }))).toThrow('boom')
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('已有備份/還原在跑：BackupBusyError，且不釋放別人的鎖', () => {
    const file = buildArchive()
    setRunningLogId(5)
    expect(() => startRestore(file, 'api', deps())).toThrow(BackupBusyError)
    expect(isBackupOrRestoreBusy()).toBe(true)
  })
})

describe('startRestore dev 模式', () => {
  it('沒有重啟 phase、沒有 restartingBeforeLastPhase/expectedVersion，結尾記錄需手動重啟', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ getInstall: () => ({ mode: 'dev', service: 'mission-control' }) }))
    expect(spec!.phases.map((p) => p.name)).toEqual(['verify', 'extract', 'restore OpenClaw', 'stage MCC database'])
    expect(spec!.restartingBeforeLastPhase).toBeUndefined()
    expect(spec!.expectedVersion).toBeUndefined()
    await done
    expect(calls).toEqual(['verify-oc', 'restore-oc', 'stage-db'])
    expect(logs).toContain('需手動重啟 MCC 才會套用資料庫還原')
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })
})

describe('惡意封存檔', () => {
  function evil(kind: 'dotdot' | 'abs' | 'symlink' | 'hardlink') {
    const src = fs.mkdtempSync(path.join(tmp, 'evil-'))
    fs.writeFileSync(path.join(src, 'x'), 'x')
    const out = path.join(tmp, 'mcc-backup_openclaw_evil_20261006_000000.tar.gz')
    if (kind === 'dotdot') execFileSync('tar', ['-P', '-czf', out, '-C', src, '--transform', 's,^x$,../x,', 'x'])
    else if (kind === 'abs') execFileSync('tar', ['-P', '-czf', out, '-C', src, '--transform', 's,^x$,/etc/x,', 'x'])
    else if (kind === 'symlink') {
      fs.symlinkSync('/etc/passwd', path.join(src, 'lnk'))
      execFileSync('tar', ['-czf', out, '-C', src, 'lnk'])
    } else {
      fs.linkSync(path.join(src, 'x'), path.join(src, 'hl'))
      execFileSync('tar', ['-czf', out, '-C', src, 'x', 'hl'])
    }
    return out
  }

  for (const kind of ['dotdot', 'abs', 'symlink', 'hardlink'] as const) {
    it(`${kind}：verify 失敗，完全不解壓、不動資料、解鎖`, async () => {
      const file = evil(kind)
      startRestore(file, 'api', deps())
      await done
      expect(calls).toEqual([])
      expect(logs.join('\n')).toMatch(/已拒絕/)
      expect(fs.existsSync(work) ? restoreDirs() : []).toEqual([])
      expect(isBackupOrRestoreBusy()).toBe(false)
    })
  }

  it('describeBackup 同樣拒絕', async () => {
    await expect(describeBackup(evil('symlink'), deps())).rejects.toThrow(/不允許的成員類型/)
  })
})

describe('legacy 與不支援', () => {
  it('舊格式有腳本：單一 phase，且沒有 restartingBeforeLastPhase', async () => {
    const f = path.join(tmp, 'openclaw-backup_x.tar.gz'); fs.writeFileSync(f, 'x')
    startRestore(f, 'api', deps())
    expect(spec!.phases.map((p) => p.name)).toEqual(['legacy restore'])
    expect(spec!.restartingBeforeLastPhase).toBeUndefined()
    await done
    expect(calls).toEqual(['legacy'])
    expect(isBackupOrRestoreBusy()).toBe(false)
  })
  it('舊格式沒有腳本：拒絕、不上鎖', () => {
    const f = path.join(tmp, 'openclaw-backup_x.tar.gz'); fs.writeFileSync(f, 'x')
    expect(() => startRestore(f, 'api', deps({ legacyScriptsOk: () => false }))).toThrow(/舊版備份腳本/)
    expect(isBackupOrRestoreBusy()).toBe(false)
  })
  it('extra / unknown：拒絕', () => {
    expect(() => startRestore(path.join(tmp, 'extra-backup_a.tar.gz'), 'api', deps())).toThrow(/不支援/)
    expect(() => startRestore(path.join(tmp, 'foo.tar.gz'), 'api', deps())).toThrow(/不支援/)
  })
})

describe('describeBackup', () => {
  it('summary 含建立時間、版本、內含項目、.env.local 不會自動還原；解壓目錄已清掉', async () => {
    const file = buildArchive()
    const d = await describeBackup(file, deps())
    expect(d.kind).toBe('mcc')
    expect(d.summary).toContain('2026-10-06T00:00:00.000Z')
    expect(d.summary).toContain('2026.9.8')
    expect(d.summary).toContain('0.3.93')
    expect(d.summary).toContain('.env.local 不會自動還原')
    expect(d.summary).toContain('mcc.env')
    expect(calls).toEqual(['verify-oc'])
    expect(restoreDirs()).toEqual([])
  })
  it('backend 為 null：不驗證 OpenClaw，summary 說明', async () => {
    const d = await describeBackup(buildArchive({ backend: null, env: false }), deps())
    expect(calls).toEqual([])
    expect(d.summary).toContain('不含')
    expect(d.summary).toContain('沒有 .env.local 副本')
  })
  it('legacy：依腳本可用性決定 legacyRestorable', async () => {
    const f = path.join(tmp, 'openclaw-backup_x.tar.gz')
    expect((await describeBackup(f, deps({ legacyScriptsOk: () => false }))).legacyRestorable).toBe(false)
    expect((await describeBackup(f, deps())).legacyRestorable).toBe(true)
  })
  it('extra：丟錯', async () => {
    await expect(describeBackup(path.join(tmp, 'extra-backup_a.tar.gz'), deps())).rejects.toThrow(/不支援/)
  })
})
