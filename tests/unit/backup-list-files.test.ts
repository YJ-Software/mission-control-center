import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const m = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {}, initDb: () => {} }))
vi.mock('@/lib/backup/helpers', () => ({
  getScriptsDir: () => '/x', getBackupOutputDir: () => '/x', formatBytes: (n: number) => `${n} B`,
  checkScriptsAvailable: m.check,
}))

import { listBackupFiles } from '@/lib/backup/scripts'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-list-'))
  for (const f of ['mcc-backup_openclaw_h_1.tar.gz', 'openclaw-backup_1.tar.gz', 'extra-backup_1.tar.gz', 'random.tar.gz', 'note.txt']) {
    fs.writeFileSync(path.join(tmp, f), 'x')
  }
  m.check.mockReset().mockReturnValue({ ok: false, dir: '', missing: ['backup.sh'] })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('listBackupFiles', () => {
  it('每筆帶 kind 與 legacyRestorable；腳本檢查每次呼叫只做一次', () => {
    const files = listBackupFiles(tmp)
    const kinds = Object.fromEntries(files.map(f => [f.filename, f.kind]))
    expect(kinds).toEqual({
      'mcc-backup_openclaw_h_1.tar.gz': 'mcc',
      'openclaw-backup_1.tar.gz': 'legacy-openclaw',
      'extra-backup_1.tar.gz': 'extra',
      'random.tar.gz': 'unknown',
    })
    expect(files.every(f => f.legacyRestorable === false)).toBe(true)
    expect(m.check).toHaveBeenCalledTimes(1)
  })
  it('腳本存在時 legacyRestorable 為 true', () => {
    m.check.mockReturnValue({ ok: true, dir: '', missing: [] })
    expect(listBackupFiles(tmp).every(f => f.legacyRestorable)).toBe(true)
  })
})
