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
import { upsertJobMeta } from '@/lib/jobs/store'
import type { JobMeta } from '@/lib/jobs/types'

let n = 0
function job(kind: JobMeta['kind'], status: JobMeta['status']) {
  upsertJobMeta({
    id: `g${++n}`, kind, label: `L-${kind}`, status, startedAt: new Date().toISOString(),
    finishedAt: null, exitCode: null, triggeredBy: 'api', phases: [],
  })
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
  it('重啟類 running / restarting 會擋，並丟 BackupBusyError', () => {
    job('upgrade-openclaw', 'running')
    expect(findBlockingJob()?.kind).toBe('upgrade-openclaw')
    expect(() => assertNoBlockingJob()).toThrow(BackupBusyError)
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
