import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { snapshotMccDb, copyEnvFile, stagePendingDbRestore } from '@/lib/backup/mcc-state'
import { applyPendingDbRestore, applyPendingDbRestoreOnce } from '@/lib/backup/pending-db-restore'

let dir: string

function makeDb(file: string, value = 'x') {
  const d = new Database(file)
  d.exec('CREATE TABLE t (v TEXT)')
  d.prepare('INSERT INTO t VALUES (?)').run(value)
  d.close()
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-state-')) })
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  delete (globalThis as any).__mccPendingDbRestoreChecked
})

describe('snapshotMccDb', () => {
  it('包含尚未 checkpoint 的 WAL 資料', async () => {
    const src = path.join(dir, 'db.sqlite')
    const live = new Database(src)
    live.pragma('journal_mode = WAL')
    live.pragma('wal_autocheckpoint = 0')
    live.exec('CREATE TABLE t (v TEXT)')
    live.prepare('INSERT INTO t VALUES (?)').run('hello')
    const dest = path.join(dir, 'snap.sqlite')
    await snapshotMccDb(src, dest)
    live.close()
    const snap = new Database(dest, { readonly: true })
    expect(snap.prepare('SELECT v FROM t').all()).toEqual([{ v: 'hello' }])
    snap.close()
  })
})

describe('snapshotMccDb 失敗與權限', () => {
  it('快照檔為 600', async () => {
    const src = path.join(dir, 'db.sqlite'); makeDb(src)
    const dest = path.join(dir, 'snap.sqlite')
    await snapshotMccDb(src, dest)
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600)
  })
  it('backup 失敗（目的目錄不存在）時唯讀連線仍被關閉', async () => {
    const src = path.join(dir, 'db.sqlite'); makeDb(src)
    const closeSpy = vi.spyOn(Database.prototype, 'close')
    await expect(snapshotMccDb(src, path.join(dir, 'no', 'such', 'snap'))).rejects.toThrow()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    closeSpy.mockRestore()
  })
  it('來源不存在直接拋錯', async () => {
    await expect(snapshotMccDb(path.join(dir, 'nope'), path.join(dir, 'o'))).rejects.toThrow()
  })
})

describe('copyEnvFile', () => {
  it('dest 既有 644 時最終仍為 600', () => {
    const src = path.join(dir, 'src'); fs.writeFileSync(src, 'NEW')
    const dest = path.join(dir, 'dest'); fs.writeFileSync(dest, 'OLD', { mode: 0o644 })
    fs.chmodSync(dest, 0o644)
    expect(copyEnvFile(src, dest)).toBe(true)
    expect(fs.readFileSync(dest, 'utf8')).toBe('NEW')
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600)
  })
  it('複製並設為 600，缺少的目的父目錄會建立', () => {
    const src = path.join(dir, '.env.local')
    fs.writeFileSync(src, 'A=1', { mode: 0o644 })
    const dest = path.join(dir, 'sub', 'dir', 'env')
    expect(copyEnvFile(src, dest)).toBe(true)
    expect(fs.readFileSync(dest, 'utf8')).toBe('A=1')
    expect(fs.statSync(dest).mode & 0o777).toBe(0o600)
  })
  it('來源不存在回傳 false', () => {
    expect(copyEnvFile(path.join(dir, 'nope'), path.join(dir, 'out'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'out'))).toBe(false)
  })
})

describe('applyPendingDbRestore', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  it('無 pending 回傳 none 且不動檔案', () => {
    fs.writeFileSync(dbp(), 'old')
    expect(applyPendingDbRestore(dbp())).toBe('none')
    expect(fs.readdirSync(dir)).toEqual(['db.sqlite'])
  })
  it('套用 pending，舊檔含 -wal/-shm 以同一時戳保留', () => {
    fs.writeFileSync(dbp(), 'old')
    fs.writeFileSync(dbp() + '-wal', 'w')
    fs.writeFileSync(dbp() + '-shm', 's')
    const snap = path.join(dir, 'snap')
    makeDb(snap, 'new')
    stagePendingDbRestore(snap, dbp())
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(true)
    expect(applyPendingDbRestore(dbp(), fs, new Date('2026-10-06T01:02:03.456Z'))).toBe('applied')
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
    const ts = '2026-10-06T01-02-03-456Z'
    expect(fs.readFileSync(`${dbp()}.pre-restore-${ts}`, 'utf8')).toBe('old')
    expect(fs.readFileSync(`${dbp()}-wal.pre-restore-${ts}`, 'utf8')).toBe('w')
    expect(fs.readFileSync(`${dbp()}-shm.pre-restore-${ts}`, 'utf8')).toBe('s')
  })
  it('舊 db 不存在（首次）也能套用，只改名存在的檔', () => {
    makeDb(dbp() + '.restore-pending')
    expect(applyPendingDbRestore(dbp())).toBe('applied')
    expect(fs.readdirSync(dir)).toEqual(['db.sqlite'])
  })
  it('pending 改名失敗時把舊檔移回並重拋', () => {
    fs.writeFileSync(dbp(), 'old')
    fs.writeFileSync(dbp() + '-wal', 'w')
    makeDb(dbp() + '.restore-pending')
    const failing = {
      ...fs,
      existsSync: fs.existsSync,
      renameSync: (a: string, b: string) => {
        if (a.endsWith('.restore-pending')) throw new Error('boom')
        fs.renameSync(a, b)
      },
    } as unknown as typeof fs
    expect(() => applyPendingDbRestore(dbp(), failing)).toThrow('boom')
    expect(fs.readFileSync(dbp(), 'utf8')).toBe('old')
    expect(fs.readFileSync(dbp() + '-wal', 'utf8')).toBe('w')
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(true)
  })
})

describe('pending 驗證與 staging', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  const corruptCases: Array<[string, () => Buffer]> = [
    ['隨機位元組', () => Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 256))],
    ['截斷的 SQLite', () => {
      const f = path.join(dir, 'full.sqlite')
      const d = new Database(f); d.exec('CREATE TABLE t (v TEXT)')
      for (let i = 0; i < 2000; i++) d.prepare('INSERT INTO t VALUES (?)').run('row' + i + 'x'.repeat(50))
      d.close()
      return fs.readFileSync(f).subarray(0, 6000)
    }],
  ]
  for (const [name, mk] of corruptCases) {
    it(`apply：${name}被拒絕，現行 db 不動，pending 改名 rejected`, () => {
      makeDb(dbp(), 'keep')
      fs.writeFileSync(dbp() + '.restore-pending', mk())
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(applyPendingDbRestore(dbp(), fs, new Date('2026-10-06T00:00:00.000Z'))).toBe('rejected')
      expect(err).toHaveBeenCalled()
      err.mockRestore()
      const d = new Database(dbp(), { readonly: true })
      expect(d.prepare('SELECT v FROM t').all()).toEqual([{ v: 'keep' }])
      d.close()
      expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
      expect(fs.existsSync(dbp() + '.restore-rejected-2026-10-06T00-00-00-000Z')).toBe(true)
    })
    it(`stage：${name}被拒絕且不產生 pending`, () => {
      const snap = path.join(dir, 'snap'); fs.writeFileSync(snap, mk())
      expect(() => stagePendingDbRestore(snap, dbp())).toThrow(/完整性/)
      expect(fs.readdirSync(dir).some(f => f.includes('restore-pending'))).toBe(false)
    })
  }
  it('stage：健康快照成功，無殘留 .tmp', () => {
    const snap = path.join(dir, 'snap'); makeDb(snap)
    stagePendingDbRestore(snap, dbp())
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(true)
    expect(fs.existsSync(dbp() + '.restore-pending.tmp')).toBe(false)
  })
  it('db 改名後、pending 改名前當機：下次啟動自癒', () => {
    // 模擬當機後狀態：db.sqlite 不在，舊檔已移開，pending 仍在
    makeDb(dbp() + '.restore-pending', 'restored')
    fs.writeFileSync(dbp() + '.pre-restore-X', 'old')
    expect(applyPendingDbRestore(dbp())).toBe('applied')
    const d = new Database(dbp(), { readonly: true })
    expect(d.prepare('SELECT v FROM t').all()).toEqual([{ v: 'restored' }])
    d.close()
  })
  it('第二個 rename（-wal）失敗時，已移開的 db 會移回', () => {
    makeDb(dbp() + '.restore-pending')
    fs.writeFileSync(dbp(), 'old')
    fs.writeFileSync(dbp() + '-wal', 'w')
    fs.writeFileSync(dbp() + '-shm', 's')
    const failing = {
      existsSync: fs.existsSync,
      renameSync: (a: string, b: string) => {
        if (a.endsWith('-wal')) throw new Error('wal boom')
        fs.renameSync(a, b)
      },
    } as unknown as typeof fs
    expect(() => applyPendingDbRestore(dbp(), failing)).toThrow('wal boom')
    expect(fs.readFileSync(dbp(), 'utf8')).toBe('old')
    expect(fs.readFileSync(dbp() + '-wal', 'utf8')).toBe('w')
    expect(fs.readFileSync(dbp() + '-shm', 'utf8')).toBe('s')
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(true)
  })
})

describe('applyPendingDbRestoreOnce', () => {
  it('每個行程只檢查一次：第二次即使有 pending 也不動作', () => {
    const dbp = path.join(dir, 'db.sqlite')
    fs.writeFileSync(dbp, 'old')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('none')
    makeDb(dbp + '.restore-pending')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('none')
    expect(fs.readFileSync(dbp, 'utf8')).toBe('old')
    expect(fs.existsSync(dbp + '.restore-pending')).toBe(true)
  })
  it('第一次呼叫會套用', () => {
    const dbp = path.join(dir, 'db.sqlite')
    makeDb(dbp + '.restore-pending')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('applied')
  })
})
