import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { snapshotMccDb, copyEnvFile, stagePendingDbRestore } from '@/lib/backup/mcc-state'
import { applyPendingDbRestore, applyPendingDbRestoreOnce } from '@/lib/backup/pending-db-restore'

let dir: string
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

describe('copyEnvFile', () => {
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
    fs.writeFileSync(snap, 'new')
    stagePendingDbRestore(snap, dbp())
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(true)
    expect(applyPendingDbRestore(dbp(), fs, new Date('2026-10-06T01:02:03.456Z'))).toBe('applied')
    expect(fs.readFileSync(dbp(), 'utf8')).toBe('new')
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
    const ts = '2026-10-06T01-02-03-456Z'
    expect(fs.readFileSync(`${dbp()}.pre-restore-${ts}`, 'utf8')).toBe('old')
    expect(fs.readFileSync(`${dbp()}-wal.pre-restore-${ts}`, 'utf8')).toBe('w')
    expect(fs.readFileSync(`${dbp()}-shm.pre-restore-${ts}`, 'utf8')).toBe('s')
  })
  it('舊 db 不存在（首次）也能套用，只改名存在的檔', () => {
    fs.writeFileSync(dbp() + '.restore-pending', 'new')
    expect(applyPendingDbRestore(dbp())).toBe('applied')
    expect(fs.readFileSync(dbp(), 'utf8')).toBe('new')
    expect(fs.readdirSync(dir)).toEqual(['db.sqlite'])
  })
  it('pending 改名失敗時把舊檔移回並重拋', () => {
    fs.writeFileSync(dbp(), 'old')
    fs.writeFileSync(dbp() + '-wal', 'w')
    fs.writeFileSync(dbp() + '.restore-pending', 'new')
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

describe('applyPendingDbRestoreOnce', () => {
  it('每個行程只檢查一次：第二次即使有 pending 也不動作', () => {
    const dbp = path.join(dir, 'db.sqlite')
    fs.writeFileSync(dbp, 'old')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('none')
    fs.writeFileSync(dbp + '.restore-pending', 'new')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('none')
    expect(fs.readFileSync(dbp, 'utf8')).toBe('old')
    expect(fs.existsSync(dbp + '.restore-pending')).toBe(true)
  })
  it('第一次呼叫會套用', () => {
    const dbp = path.join(dir, 'db.sqlite')
    fs.writeFileSync(dbp + '.restore-pending', 'new')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('applied')
  })
})
