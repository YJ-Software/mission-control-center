import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

const h = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MISSION_CONTROL_DATA_DIR = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-guard-data-'))
  return {}
})

import { findBlockingJob, assertNoBlockingJob } from '@/lib/backup/job-guard'
import { BackupBusyError, acquireLock, releaseLock, isBackupOrRestoreBusy, setRunningLogId } from '@/lib/backup/lock'
import { upsertJobMeta, readAllJobsSync } from '@/lib/jobs/store'
import { startJob } from '@/lib/jobs/runner'
import type { JobMeta } from '@/lib/jobs/types'

/** 由本行程的 runner 真正執行中的 job：回傳 release 讓它結束 */
function liveJob(kind: JobMeta['kind']) {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let settled!: () => void
  const done = new Promise<void>((r) => { settled = r })
  const meta = startJob({
    kind, label: `Live-${kind}`, triggeredBy: 'api',
    phases: [{ name: 'work', inline: async () => { await gate; return 0 } }],
    onSettled: () => settled(),
  })
  return { meta, finish: async () => { release(); await done } }
}

let n = 0
function job(kind: JobMeta['kind'], status: JobMeta['status']): string {
  upsertJobMeta({
    id: `g${++n}`, kind, label: `L-${kind}`, status, startedAt: new Date().toISOString(),
    finishedAt: null, exitCode: null, triggeredBy: 'api', phases: [],
  })
  return `g${n}`
}

describe('findBlockingJob', () => {
  it('沒有 job 時不擋', () => { expect(findBlockingJob()).toBeNull() })
  it('已結束的重啟類 job 不擋', () => {
    job('upgrade-mcc', 'success'); job('restart-mcc', 'failed')
    expect(findBlockingJob()).toBeNull()
  })
  it('非重啟類 job（doctor）執行中不擋', () => {
    job('doctor', 'running')
    expect(findBlockingJob()).toBeNull()
  })
  it('重啟類 job 由本行程執行中會擋，並丟 BackupBusyError；結束後不擋', async () => {
    const j = liveJob('upgrade-openclaw')
    expect(findBlockingJob()?.id).toBe(j.meta.id)
    expect(() => assertNoBlockingJob()).toThrow(BackupBusyError)
    await j.finish()
    expect(findBlockingJob()).toBeNull()
  })
  it('I2：前一個 MCC 行程留下的 running / restarting job（行程已死）不擋，且被標為 failed', () => {
    // 剛開始不到 10 分鐘：舊的 STALE_MS 規則還不會回收它，但它不屬於本行程的 runner
    const ids = [job('upgrade-openclaw', 'running'), job('restart-mcc', 'restarting')]
    expect(findBlockingJob()).toBeNull()
    expect(() => assertNoBlockingJob()).not.toThrow()
    const left = readAllJobsSync().filter((x) => ids.includes(x.id))
    expect(left.map((x) => x.status)).toEqual(['failed', 'failed'])
  })
  it('I2：孤兒與本行程真正執行中的 job 並存時，只有後者會擋', async () => {
    job('upgrade-mcc', 'running')
    const j = liveJob('reboot-host')
    expect(findBlockingJob()?.id).toBe(j.meta.id)
    await j.finish()
    expect(findBlockingJob()).toBeNull()
  })
  it('restarting 狀態也擋', () => {
    expect(() => assertNoBlockingJob(() => ({ kind: 'restart-mcc', label: 'x', status: 'restarting' }) as never)).toThrow(BackupBusyError)
  })
})

describe('lock owner token', () => {
  beforeEach(() => setRunningLogId(null))
  it('過期 token 釋放不掉較新擁有者的鎖', () => {
    const a = acquireLock(1)
    releaseLock(a)
    const b = acquireLock(2)
    expect(releaseLock(a)).toBe(false)
    expect(isBackupOrRestoreBusy()).toBe(true)
    expect(releaseLock(b)).toBe(true)
    expect(isBackupOrRestoreBusy()).toBe(false)
  })
})
