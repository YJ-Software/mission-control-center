import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  verify: vi.fn(),
  busy: vi.fn(),
  start: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {} }))
vi.mock('@/lib/backup/helpers', () => ({ verifyBackupToken: m.verify }))
vi.mock('@/lib/backup/scripts', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/backup/run-backup', async () => {
  class BackupJobNotFoundError extends Error {}
  class BackupBusyError extends Error {}
  return { startBackupRun: m.start, BackupJobNotFoundError, BackupBusyError }
})

import { POST } from '@/app/api/backup/run/route'
import { BackupJobNotFoundError, BackupBusyError } from '@/lib/backup/run-backup'

function req(body: unknown) {
  return new NextRequest('http://mcc.local/api/backup/run', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  m.verify.mockReset().mockReturnValue(true)
  m.busy.mockReset().mockReturnValue(false)
  m.start.mockReset().mockReturnValue({ logId: 7, jobMetaId: 'job-x' })
})

describe('POST /api/backup/run', () => {
  it('401：token 無效時不啟動', async () => {
    m.verify.mockReturnValue(false)
    const res = await POST(req({}))
    expect(res.status).toBe(401)
    expect(m.start).not.toHaveBeenCalled()
  })
  it('409：已有備份/還原在跑', async () => {
    m.busy.mockReturnValue(true)
    expect((await POST(req({}))).status).toBe(409)
    expect(m.start).not.toHaveBeenCalled()
  })
  it('409：啟動時競態遇到 BackupBusyError', async () => {
    m.start.mockImplementation(() => { throw new BackupBusyError() })
    expect((await POST(req({}))).status).toBe(409)
  })
  it('404：找不到 job', async () => {
    m.start.mockImplementation(() => { throw new BackupJobNotFoundError() })
    expect((await POST(req({ jobId: 'nope' }))).status).toBe(404)
  })
  it('500：其他錯誤', async () => {
    m.start.mockImplementation(() => { throw new Error('boom') })
    expect((await POST(req({}))).status).toBe(500)
  })
  it('成功：回 { ok, logId, jobId }，參數原樣傳入，triggeredBy 預設 api', async () => {
    const res = await POST(req({ jobId: 'j1', destinationId: 'd1', sourceIds: ['a'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, logId: 7, jobId: 'job-x' })
    expect(m.start).toHaveBeenCalledWith({ jobId: 'j1', destinationId: 'd1', sourceIds: ['a'], triggeredBy: 'api' })
  })
  it('triggeredBy：合法值採用，非法值退回 api', async () => {
    await POST(req({ triggeredBy: 'cron' }))
    expect(m.start.mock.calls[0][0].triggeredBy).toBe('cron')
    await POST(req({ triggeredBy: 'evil' }))
    expect(m.start.mock.calls[1][0].triggeredBy).toBe('api')
  })
})
