import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 刪除路由必須和還原路由用同一套 realpath 範圍檢查（resolveInsideDirs），不可用字串前綴比對
const m = vi.hoisted(() => ({ dirs: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {}, DB_PATH: '/nonexistent/db.sqlite' }))
vi.mock('@/lib/backup/availability', () => ({ getBackupAvailability: vi.fn() }))
vi.mock('@/lib/backup/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/backup/helpers')>()),
  getAllBackupDirs: m.dirs,
}))

import { POST } from '@/app/api/backup/route'

let tmp: string
let backupDir: string
const del = (file: unknown) =>
  POST(new NextRequest('http://mcc.local/api/backup?action=delete', { method: 'POST', body: JSON.stringify({ file }) }))

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-delete-route-'))
  backupDir = path.join(tmp, 'backup')
  fs.mkdirSync(backupDir)
  m.dirs.mockReset().mockReturnValue([backupDir])
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('POST /api/backup?action=delete', () => {
  it('允許目錄內的備份檔：刪除', async () => {
    const f = path.join(backupDir, 'mcc-backup_openclaw_h_1.tar.gz'); fs.writeFileSync(f, 'x')
    const res = await del(f)
    expect(res.status).toBe(200)
    expect(fs.existsSync(f)).toBe(false)
  })

  it('400：允許目錄之外（含同前綴的兄弟目錄）不刪', async () => {
    const outside = path.join(tmp, 'outside.tar.gz'); fs.writeFileSync(outside, 'x')
    expect((await del(outside)).status).toBe(400)
    expect(fs.existsSync(outside)).toBe(true)
    // /x/backup 不可涵蓋 /x/backup-old
    fs.mkdirSync(path.join(tmp, 'backup-old'))
    const sibling = path.join(tmp, 'backup-old', 'mcc-backup_x.tar.gz'); fs.writeFileSync(sibling, 'x')
    expect((await del(sibling)).status).toBe(400)
    expect(fs.existsSync(sibling)).toBe(true)
  })

  it('400：路徑含 .. 跳出允許目錄不刪', async () => {
    const outside = path.join(tmp, 'outside.tar.gz'); fs.writeFileSync(outside, 'x')
    expect((await del(`${backupDir}/../outside.tar.gz`)).status).toBe(400)
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('400：目錄內的 symlink 指向目錄外，不刪目標也不刪連結', async () => {
    const outside = path.join(tmp, 'outside.tar.gz'); fs.writeFileSync(outside, 'x')
    const link = path.join(backupDir, 'mcc-backup_link.tar.gz')
    fs.symlinkSync(outside, link)
    expect((await del(link)).status).toBe(400)
    expect(fs.existsSync(outside)).toBe(true)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it('400：允許目錄內的子目錄是指向外部的 symlink', async () => {
    const ext = path.join(tmp, 'ext'); fs.mkdirSync(ext)
    const target = path.join(ext, 'mcc-backup_y.tar.gz'); fs.writeFileSync(target, 'x')
    fs.symlinkSync(ext, path.join(backupDir, 'sub'))
    expect((await del(path.join(backupDir, 'sub', 'mcc-backup_y.tar.gz'))).status).toBe(400)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('400：不是 .tar.gz', async () => {
    const f = path.join(backupDir, 'notes.txt'); fs.writeFileSync(f, 'x')
    expect((await del(f)).status).toBe(400)
    expect(fs.existsSync(f)).toBe(true)
  })

  it('400：缺 file', async () => {
    expect((await del(undefined)).status).toBe(400)
  })
})
