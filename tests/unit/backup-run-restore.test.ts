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

import { RestoreRejectedError, assertSafeArchive, startRestore, describeBackup, defaultTar, type RestoreDeps } from '@/lib/backup/run-restore'
import { BackupBusyError } from '@/lib/backup/run-backup'
import { isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/scripts'
import type { JobSpec } from '@/lib/jobs/runner'

let tmp: string
let work: string
let calls: string[]
let spec: JobSpec | null
let done: Promise<void>
let logs: string[]
let discards = 0
let finalStatus: 'success' | 'failed' | null = null

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
      finalStatus = 'success'
      for (const p of s.phases) {
        let code = 0
        try { code = await p.inline!((_st, t) => { logs.push(t) }, { setExpectedVersion() {}, setExtra() {} }) } catch { code = 1 }
        if (code !== 0) { finalStatus = 'failed'; break }
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
    prepareDb: () => { calls.push('prepare-db') },
    commitDb: () => { calls.push('commit-db') },
    discardPreparedDb: () => { discards++ },
    discardPendingDb: () => { calls.push('discard-pending') },
    gatewayPreflight: async () => { calls.push('preflight') },
    runningSemver: () => '0.3.99',
    restartLockHoldMs: 60_000,
    legacyDryRun: async () => 'legacy dry',
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
  calls = []; spec = null; logs = []; discards = 0; finalStatus = null
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
    expect(calls).toEqual(['prepare-db', 'preflight', 'verify-oc', 'restore-oc', 'commit-db', 'restart:mission-control'])
  })

  it('prepareDb 收到正在還原的封存檔路徑（用來補上快照當下未知的備份大小）', async () => {
    const file = buildArchive()
    let got: unknown[] = []
    startRestore(file, 'api', deps({ prepareDb: (...args) => { got = args } }))
    await done
    expect(got[1]).toBe(path.join(tmp, 'db.sqlite'))
    expect(got[2]).toBe(path.resolve(file))
  })

  it('M2：重啟訊息如實說明工作在排程重啟後即標示完成，資料庫是否套用要重啟後才知道', async () => {
    startRestore(buildArchive(), 'api', deps())
    await done
    const log = logs.join('\n')
    expect(log).not.toContain('重啟後此工作將標示完成')
    expect(log).toContain('排程重啟後即標示完成')
    expect(log).toContain('MCC 重啟後')
  })

  it('執行中持有鎖；成功後解壓目錄已移除', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps())
    expect(isBackupOrRestoreBusy()).toBe(true)
    await done
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
    expect(calls).toEqual(['prepare-db', 'commit-db', 'restart:mission-control'])
    expect(logs.join('\n')).toContain('不含 OpenClaw 資料，略過')
  })

  it('OpenClaw 還原失敗：job 失敗、不 stage DB、不重啟、錯誤原文進 log、解鎖並清目錄', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({
      openclawRestore: async () => { throw new Error('Restore failed (x); rolled back. Previous data intact at /h/.openclaw.') },
    }))
    await done
    expect(calls).toEqual(['prepare-db', 'preflight', 'verify-oc'])
    expect(logs.join('\n')).toContain('Previous data intact at /h/.openclaw.')
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('OpenClaw verify 失敗：不會動現行資料，job 失敗，暫存 DB 被清掉', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ openclawVerify: async () => { throw new Error('bad archive') } }))
    await done
    expect(calls).toEqual(['prepare-db', 'preflight'])
    expect(finalStatus).toBe('failed')
    expect(discards).toBeGreaterThanOrEqual(2) // 開頭清掃 + finalize
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('DB 快照不健康/準備失敗：在 OpenClaw 還原之前就中止，且 gateway 前置檢查都沒跑', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ prepareDb: () => { throw new Error('快照無法通過完整性檢查') } }))
    await done
    expect(calls).toEqual([])
    expect(finalStatus).toBe('failed')
    expect(logs.join('\n')).toContain('完整性檢查')
    expect(restoreDirs()).toEqual([])
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('gateway 前置檢查失敗：不驗證、不還原', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ gatewayPreflight: async () => { throw new Error('gateway 不是由 openclaw-gateway user unit 管理，無法安全還原') } }))
    await done
    expect(calls).toEqual(['prepare-db'])
    expect(logs.join('\n')).toContain('無法安全還原')
    expect(finalStatus).toBe('failed')
  })

  it('commit DB 失敗（OpenClaw 已換）：job 失敗，訊息含 OpenClaw 已還原、pre-restore 目錄、可重跑', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ commitDb: () => { throw new Error('EXDEV') } }))
    await done
    expect(calls).toEqual(['prepare-db', 'preflight', 'verify-oc', 'restore-oc'])
    const log = logs.join('\n')
    expect(log).toMatch(/EXDEV.*OpenClaw 已還原.*MCC 資料庫未還原/)
    expect(log).toContain('/pre')
    expect(log).toContain('重新執行同一份備份的還原是安全的')
    expect(finalStatus).toBe('failed')
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })

  it('排程重啟丟錯：job 失敗、撤銷 pending、明確記錄 DB 未還原、解鎖', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ scheduleRestart: () => { throw new Error('spawn fail') } }))
    await done
    expect(finalStatus).toBe('failed')
    expect(calls).toContain('discard-pending')
    expect(logs).toContain('OpenClaw 已還原；MCC 資料庫未還原（排程重啟失敗）')
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('release：成功時 job success，鎖在重啟前仍持有，並在 restartLockHoldMs 後釋放', async () => {
    const file = buildArchive()
    startRestore(file, 'api', deps({ restartLockHoldMs: 80 }))
    await done
    expect(finalStatus).toBe('success')
    expect(isBackupOrRestoreBusy()).toBe(true) // 重啟前不放鎖，onSettled 也不放
    expect(restoreDirs()).toEqual([])
    await new Promise((r) => setTimeout(r, 200))
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('開始時清掃殘留的 .restore-* 孤兒目錄', async () => {
    fs.mkdirSync(path.join(work, '.restore-111'), { recursive: true })
    fs.writeFileSync(path.join(work, '.restore-111', 'secret'), 'x')
    fs.writeFileSync(path.join(work, 'keep.txt'), 'k')
    startRestore(buildArchive(), 'api', deps({ getInstall: () => ({ mode: 'dev', service: 's' }) }))
    expect(fs.existsSync(path.join(work, '.restore-111'))).toBe(false)
    expect(fs.existsSync(path.join(work, 'keep.txt'))).toBe(true)
    await done
  })

  it('install mode unknown：在上鎖與任何動作之前拒絕', () => {
    expect(() => startRestore(buildArchive(), 'api', deps({ getInstall: () => ({ mode: 'unknown', service: 's' }) })))
      .toThrow(RestoreRejectedError)
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(calls).toEqual([])
  })

  it('backend 不是 openclaw（hermes）：extract 失敗，不動資料', async () => {
    const file = buildArchive()
    // 重新打包一份 backend=hermes 的 manifest
    const stage = fs.mkdtempSync(path.join(tmp, 'h-'))
    execFileSync('tar', ['xzf', file, '-C', stage])
    const mf = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8')); mf.backend = 'hermes'
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(mf))
    const out = path.join(tmp, 'mcc-backup_hermes_h_1.tar.gz')
    execFileSync('tar', ['czf', out, '-C', stage, '.'])
    startRestore(out, 'api', deps())
    await done
    expect(calls).toEqual([])
    expect(logs.join('\n')).toContain('不支援還原 hermes')
    expect(finalStatus).toBe('failed')
  })

  it('備份的 MCC 版本比現行新：log 警告但仍繼續', async () => {
    startRestore(buildArchive(), 'api', deps({ runningSemver: () => '0.3.1' }))
    await done
    expect(logs.join('\n')).toContain('來自較新的 MCC')
    expect(finalStatus).toBe('success')
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

  it('重啟類 job 進行中：BackupBusyError，不上鎖、不動任何東西', () => {
    const job = { id: 'j', kind: 'restart-openclaw', label: 'Restart OpenClaw', status: 'running' } as never
    expect(() => startRestore(buildArchive(), 'api', deps({ findBlockingJob: () => job }))).toThrow(BackupBusyError)
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(calls).toEqual([])
  })

  it('過期的安全計時器不可清掉較新擁有者的鎖（owner token）', async () => {
    startRestore(buildArchive(), 'api', deps({ restartLockHoldMs: 60 }))
    await done
    expect(isBackupOrRestoreBusy()).toBe(true)
    setRunningLogId(77) // 計時器觸發前，另一個擁有者接手
    await new Promise((r) => setTimeout(r, 200))
    expect(isBackupOrRestoreBusy()).toBe(true)
  })

  it('manifest 讀取帶 --occurrence=1', async () => {
    const seen: string[][] = []
    await describeBackup(buildArchive(), deps({ tar: async (a) => { seen.push(a); return tarReal(a) } }))
    expect(seen[0]).toContain('--occurrence=1')
  })

  it('已有備份/還原在跑：BackupBusyError，且不釋放別人的鎖', () => {
    const file = buildArchive()
    setRunningLogId(5)
    expect(() => startRestore(file, 'api', deps())).toThrow(BackupBusyError)
    expect(isBackupOrRestoreBusy()).toBe(true)
  })
})

describe('解壓目錄權限', () => {
  it('封存自帶的 ./ 是 0777 也不會放寬 .restore-<ts>（內容解在子目錄）', async () => {
    const stage = fs.mkdtempSync(path.join(tmp, 'wide-'))
    fs.chmodSync(stage, 0o777)
    fs.writeFileSync(path.join(stage, 'mcc.sqlite'), 'x')
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({
      format: 1, backend: 'openclaw', backendVersion: null, mccVersion: '0.3.93', createdAt: 't', hostname: 'h',
      parts: { backend: null, mccDb: 'mcc.sqlite', mccEnv: null },
    }))
    const out = path.join(tmp, 'mcc-backup_openclaw_h_2.tar.gz')
    execFileSync('tar', ['czf', out, '-C', stage, '.'])
    let parentMode = 0, contentMode = 0
    startRestore(out, 'api', deps({
      prepareDb: () => {
        const d = restoreDirs()[0]
        parentMode = fs.statSync(path.join(work, d)).mode & 0o777
        contentMode = fs.statSync(path.join(work, d, 'content')).mode & 0o777
      },
    }))
    await done
    expect(parentMode).toBe(0o700)
    expect(contentMode).not.toBe(0o700) // 證明 ./ 的寬權限確實落到內容目錄，而父目錄不受影響
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
    expect(calls).toEqual(['prepare-db', 'preflight', 'verify-oc', 'restore-oc', 'commit-db'])
    expect(logs).toContain('需手動重啟 MCC 才會套用資料庫還原')
    expect(logs.join('\n')).toContain('1 小時後失效')
    expect(finalStatus).toBe('success')
    expect(isBackupOrRestoreBusy()).toBe(false)
    expect(restoreDirs()).toEqual([])
  })
})

describe('惡意封存檔', () => {
  function evil(kind: 'dotdot' | 'abs' | 'symlink' | 'hardlink' | 'fifo') {
    const src = fs.mkdtempSync(path.join(tmp, 'evil-'))
    fs.writeFileSync(path.join(src, 'x'), 'x')
    const out = path.join(tmp, 'mcc-backup_openclaw_evil_20261006_000000.tar.gz')
    if (kind === 'dotdot') execFileSync('tar', ['-P', '-czf', out, '-C', src, '--transform', 's,^x$,../x,', 'x'])
    else if (kind === 'abs') execFileSync('tar', ['-P', '-czf', out, '-C', src, '--transform', 's,^x$,/etc/x,', 'x'])
    else if (kind === 'symlink') {
      fs.symlinkSync('/etc/passwd', path.join(src, 'lnk'))
      execFileSync('tar', ['-czf', out, '-C', src, 'lnk'])
    } else if (kind === 'fifo') {
      execFileSync('mkfifo', [path.join(src, 'ff')])
      execFileSync('tar', ['-czf', out, '-C', src, 'ff'])
    } else {
      fs.linkSync(path.join(src, 'x'), path.join(src, 'hl'))
      execFileSync('tar', ['-czf', out, '-C', src, 'x', 'hl'])
    }
    return out
  }

  for (const kind of ['dotdot', 'abs', 'symlink', 'hardlink', 'fifo'] as const) {
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

  it('不誤判：./ 開頭的正常成員、名稱含換行與類 symlink 文字的檔案都能通過', async () => {
    const ok = buildArchive()
    expect((await assertSafeArchive(tarReal, ok)).every((n) => n.startsWith('./'))).toBe(true)
    const src = fs.mkdtempSync(path.join(tmp, 'nl-'))
    fs.writeFileSync(path.join(src, 'a\nlrwxrwxrwx x -> y'), 'x')
    const out = path.join(tmp, 'nl.tar.gz')
    execFileSync('tar', ['-czf', out, '-C', src, '.'])
    await expect(assertSafeArchive(tarReal, out)).resolves.toBeTruthy()
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

describe('describeBackup（只讀 manifest，不解壓）', () => {
  it('summary 含建立時間、版本、內含項目、.env.local 不會自動還原；不呼叫驗證、不建任何目錄', async () => {
    const file = buildArchive()
    const d = await describeBackup(file, deps())
    expect(d.kind).toBe('mcc')
    expect(d.summary).toContain('2026-10-06T00:00:00.000Z')
    expect(d.summary).toContain('2026.9.8')
    expect(d.summary).toContain('0.3.93')
    expect(d.summary).toContain('.env.local 不會自動還原')
    expect(d.summary).toContain('mcc.env')
    expect(calls).toEqual([])
    expect(fs.existsSync(work)).toBe(false)
  })
  it('manifest 來自較新的 MCC：summary 警告', async () => {
    const d = await describeBackup(buildArchive(), deps({ runningSemver: () => '0.3.1' }))
    expect(d.summary).toContain('來自較新的 MCC')
  })
  it('backend 為 null：summary 說明不含 OpenClaw', async () => {
    const d = await describeBackup(buildArchive({ backend: null, env: false }), deps())
    expect(d.summary).toContain('不含')
    expect(d.summary).toContain('沒有 .env.local 副本')
  })
  it('封存沒有 manifest.json / manifest 無效：RestoreRejectedError（route 回 400）', async () => {
    const src = fs.mkdtempSync(path.join(tmp, 'nm-')); fs.writeFileSync(path.join(src, 'a'), 'a')
    const out = path.join(tmp, 'mcc-backup_openclaw_nm.tar.gz')
    execFileSync('tar', ['czf', out, '-C', src, '.'])
    await expect(describeBackup(out, deps())).rejects.toBeInstanceOf(RestoreRejectedError)
    fs.writeFileSync(path.join(src, 'manifest.json'), '{"format":2}')
    execFileSync('tar', ['czf', out, '-C', src, '.'])
    await expect(describeBackup(out, deps())).rejects.toBeInstanceOf(RestoreRejectedError)
  })
  it('legacy：腳本可用時回傳 dry-run 輸出，不可用時 legacyRestorable=false', async () => {
    const f = path.join(tmp, 'openclaw-backup_x.tar.gz')
    expect((await describeBackup(f, deps({ legacyScriptsOk: () => false }))).legacyRestorable).toBe(false)
    const ok = await describeBackup(f, deps())
    expect(ok.legacyRestorable).toBe(true)
    expect(ok.summary).toBe('legacy dry')
  })
  it('extra：RestoreRejectedError', async () => {
    await expect(describeBackup(path.join(tmp, 'extra-backup_a.tar.gz'), deps())).rejects.toBeInstanceOf(RestoreRejectedError)
  })
})
