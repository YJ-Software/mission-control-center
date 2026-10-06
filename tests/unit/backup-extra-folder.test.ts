import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { backupExtraFolder } from '@/lib/backup/extra-folder'

const dirs: string[] = []
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-bk-'))
  dirs.push(d)
  return d
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('backupExtraFolder', () => {
  it('建立正確檔名、排除指定項目、chmod 600', async () => {
    const base = tmp()
    const src = path.join(base, 'proj')
    fs.mkdirSync(path.join(src, 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(src, '.git'))
    fs.writeFileSync(path.join(src, 'node_modules', 'x'), 'x')
    fs.writeFileSync(path.join(src, '.git', 'h'), 'h')
    fs.writeFileSync(path.join(src, 'old.tar.gz'), 'z')
    fs.writeFileSync(path.join(src, 'a.txt'), 'a')
    const out = path.join(base, 'out', 'nested')
    const now = new Date(2026, 9, 6, 7, 8, 9)
    const r = await backupExtraFolder(src, out, 'my name/../x', now)
    expect(r.filename).toBe('extra-backup_my_name_.._x_20261006_070809.tar.gz')
    expect(r.filePath).toBe(path.join(out, r.filename))
    expect(r.size).toBeGreaterThan(0)
    expect(fs.statSync(r.filePath).mode & 0o777).toBe(0o600)
    const list = execFileSync('tar', ['tzf', r.filePath]).toString()
    expect(list.split('\n').filter(Boolean).sort()).toEqual(['proj/', 'proj/a.txt'])
  })

  it('來源不存在或不是目錄時拋錯', async () => {
    const base = tmp()
    await expect(backupExtraFolder(path.join(base, 'nope'), base, 'n')).rejects.toThrow()
    const f = path.join(base, 'file')
    fs.writeFileSync(f, '1')
    await expect(backupExtraFolder(f, base, 'n')).rejects.toThrow()
  })

  it('來源資料夾以 - 開頭時不被 tar 當成選項', async () => {
    const base = tmp()
    for (const n of ['-x', '--checkpoint-action=exec=true']) {
      const src = path.join(base, n)
      fs.mkdirSync(src)
      fs.writeFileSync(path.join(src, 'f.txt'), '1')
      const r = await backupExtraFolder(src, path.join(base, 'o'), 'd')
      const list = execFileSync('tar', ['tzf', r.filePath]).toString().split('\n').filter(Boolean).sort()
      expect(list).toEqual([`${n}/`, `${n}/f.txt`])
    }
  })

  it('名稱保留中文與底線化空白；清完為空則用 folder', async () => {
    const base = tmp()
    const src = path.join(base, 's')
    fs.mkdirSync(src)
    const now = new Date(2026, 0, 2, 3, 4, 5)
    expect((await backupExtraFolder(src, base, '客戶資料', now)).filename).toBe('extra-backup_客戶資料_20260102_030405.tar.gz')
    expect((await backupExtraFolder(src, base, 'Obsidian Vault', now)).filename).toBe('extra-backup_Obsidian_Vault_20260102_030405.tar.gz')
    expect((await backupExtraFolder(src, base, '', now)).filename).toBe('extra-backup_folder_20260102_030405.tar.gz')
    expect((await backupExtraFolder(src, base, '--..', now)).filename).toBe('extra-backup_folder_20260102_030405_2.tar.gz')
  })

  it('同名檔案已存在時加 _2、_3，不覆蓋', async () => {
    const base = tmp()
    const src = path.join(base, 's')
    fs.mkdirSync(src)
    const now = new Date(2026, 0, 2, 3, 4, 5)
    const a = await backupExtraFolder(src, base, 'n', now)
    const b = await backupExtraFolder(src, base, 'n', now)
    const c = await backupExtraFolder(src, base, 'n', now)
    expect([a.filename, b.filename, c.filename]).toEqual([
      'extra-backup_n_20260102_030405.tar.gz',
      'extra-backup_n_20260102_030405_2.tar.gz',
      'extra-backup_n_20260102_030405_3.tar.gz',
    ])
  })

  it('tar 失敗時刪除殘留輸出並帶 stderr 結尾丟錯', async () => {
    const base = tmp()
    const src = path.join(base, 's')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'a'), '1')
    const outFile = path.join(base, 'notadir')
    fs.writeFileSync(outFile, 'x')
    await expect(backupExtraFolder(src, outFile, 'n')).rejects.toThrow()
    // 以假 tar 模擬寫出部分檔案後 exit 2
    const bin = tmp()
    fs.writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\necho partial > "$2"\necho "boom: disk on fire" >&2\nexit 2\n', { mode: 0o755 })
    const oldPath = process.env.PATH
    process.env.PATH = `${bin}:${oldPath}`
    try {
      const out = path.join(base, 'out')
      await expect(backupExtraFolder(src, out, 'n')).rejects.toThrow(/exit 2[\s\S]*boom: disk on fire/)
      expect(fs.readdirSync(out)).toEqual([])
    } finally {
      process.env.PATH = oldPath
    }
  })

  it('tar exit 1 且檔案存在時視為成功並回傳 warning', async () => {
    const base = tmp()
    const src = path.join(base, 's')
    fs.mkdirSync(src)
    const bin = tmp()
    fs.writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\necho data > "$2"\necho "file changed as we read it" >&2\nexit 1\n', { mode: 0o755 })
    const oldPath = process.env.PATH
    process.env.PATH = `${bin}:${oldPath}`
    try {
      const r = await backupExtraFolder(src, path.join(base, 'o'), 'n')
      expect(r.warning).toMatch(/exit 1/)
      expect(fs.existsSync(r.filePath)).toBe(true)
      expect(fs.statSync(r.filePath).mode & 0o777).toBe(0o600)
    } finally {
      process.env.PATH = oldPath
    }
  })
})
