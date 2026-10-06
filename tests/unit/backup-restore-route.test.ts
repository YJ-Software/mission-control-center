import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const m = vi.hoisted(() => ({
  verify: vi.fn(), busy: vi.fn(), start: vi.fn(), describe: vi.fn(), dirs: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {} }))
vi.mock('@/lib/backup/helpers', () => ({ verifyBackupToken: m.verify, getAllBackupDirs: m.dirs }))
vi.mock('@/lib/backup/scripts', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/backup/run-restore', () => {
  class BackupBusyError extends Error {}
  class RestoreRejectedError extends Error {}
  return { startRestore: m.start, describeBackup: m.describe, BackupBusyError, RestoreRejectedError }
})

import { POST } from '@/app/api/backup/restore/route'
import { BackupBusyError, RestoreRejectedError } from '@/lib/backup/run-restore'

let tmp: string
let file: string
const req = (body: unknown) =>
  new NextRequest('http://mcc.local/api/backup/restore', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-restore-route-'))
  fs.mkdirSync(path.join(tmp, 'backup'))
  file = path.join(tmp, 'backup', 'mcc-backup_openclaw_h_1.tar.gz')
  fs.writeFileSync(file, 'x')
  m.verify.mockReset().mockReturnValue(true)
  m.busy.mockReset().mockReturnValue(false)
  m.dirs.mockReset().mockReturnValue([path.join(tmp, 'backup')])
  m.start.mockReset().mockReturnValue({ id: 'job-9' })
  m.describe.mockReset().mockResolvedValue({ kind: 'mcc', legacyRestorable: false, summary: '摘要' })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('POST /api/backup/restore', () => {
  it('401', async () => {
    m.verify.mockReturnValue(false)
    expect((await POST(req({ file }))).status).toBe(401)
    expect(m.start).not.toHaveBeenCalled()
  })
  it('400：缺 file', async () => {
    expect((await POST(req({}))).status).toBe(400)
  })
  it('400：路徑在允許目錄之外（含 .. 與同前綴目錄）', async () => {
    const outside = path.join(tmp, 'outside.tar.gz'); fs.writeFileSync(outside, 'x')
    expect((await POST(req({ file: outside }))).status).toBe(400)
    expect((await POST(req({ file: path.join(tmp, 'backup', '..', 'outside.tar.gz') }))).status).toBe(400)
    fs.mkdirSync(path.join(tmp, 'backup-evil'))
    const evil = path.join(tmp, 'backup-evil', 'mcc-backup_x.tar.gz'); fs.writeFileSync(evil, 'x')
    expect((await POST(req({ file: evil }))).status).toBe(400)
    expect(m.start).not.toHaveBeenCalled()
  })
  it('400：目錄內 symlink 指向目錄外', async () => {
    const outside = path.join(tmp, 'outside.tar.gz'); fs.writeFileSync(outside, 'x')
    const link = path.join(tmp, 'backup', 'mcc-backup_link.tar.gz')
    fs.symlinkSync(outside, link)
    expect((await POST(req({ file: link }))).status).toBe(400)
  })
  it('400：舊格式且沒有舊腳本（dryRun）', async () => {
    m.describe.mockResolvedValue({ kind: 'legacy-openclaw', legacyRestorable: false, summary: '需要舊版備份腳本' })
    const f = path.join(tmp, 'backup', 'openclaw-backup_a.tar.gz'); fs.writeFileSync(f, 'x')
    const res = await POST(req({ file: f, dryRun: true }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('舊版備份腳本')
  })
  it('400：舊格式沒有腳本（實際還原）', async () => {
    m.start.mockImplementation(() => { throw new RestoreRejectedError('需要舊版備份腳本') })
    const f = path.join(tmp, 'backup', 'openclaw-backup_a.tar.gz'); fs.writeFileSync(f, 'x')
    expect((await POST(req({ file: f }))).status).toBe(400)
  })
  it('dryRun：回 { ok, output, kind } 且不啟動', async () => {
    const res = await POST(req({ file, dryRun: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, output: '摘要', kind: 'mcc' })
    expect(m.start).not.toHaveBeenCalled()
  })
  it('409：忙碌（預檢）', async () => {
    m.busy.mockReturnValue(true)
    expect((await POST(req({ file }))).status).toBe(409)
    expect(m.start).not.toHaveBeenCalled()
  })
  it('409：啟動競態 BackupBusyError', async () => {
    m.start.mockImplementation(() => { throw new BackupBusyError() })
    expect((await POST(req({ file }))).status).toBe(409)
  })
  it('500：其他錯誤', async () => {
    m.start.mockImplementation(() => { throw new Error('boom') })
    expect((await POST(req({ file }))).status).toBe(500)
  })
  it('成功：回 { ok, jobId }，傳入真實路徑與 triggeredBy', async () => {
    const res = await POST(req({ file, triggeredBy: 'settings-card' }))
    expect(await res.json()).toEqual({ ok: true, jobId: 'job-9' })
    expect(m.start).toHaveBeenCalledWith(fs.realpathSync(file), 'settings-card')
  })
})
