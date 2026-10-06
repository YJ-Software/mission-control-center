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
    expect(r.filename).toBe('extra-backup_myname..x_20261006_070809.tar.gz')
    expect(r.filePath).toBe(path.join(out, r.filename))
    expect(r.size).toBeGreaterThan(0)
    expect(fs.statSync(r.filePath).mode & 0o777).toBe(0o600)
    const list = execFileSync('tar', ['tzf', r.filePath]).toString()
    expect(list).toContain('proj/a.txt')
    expect(list).not.toContain('node_modules')
    expect(list).not.toContain('.git')
    expect(list).not.toContain('old.tar.gz')
  })

  it('來源不存在或不是目錄時拋錯', async () => {
    const base = tmp()
    await expect(backupExtraFolder(path.join(base, 'nope'), base, 'n')).rejects.toThrow()
    const f = path.join(base, 'file')
    fs.writeFileSync(f, '1')
    await expect(backupExtraFolder(f, base, 'n')).rejects.toThrow()
  })
})
