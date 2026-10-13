import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { snapshotMccDb, copyEnvFile, stagePendingDbRestore, markBackupRowInSnapshot } from '@/lib/backup/mcc-state'
import { applyPendingDbRestore, applyPendingDbRestoreOnce, isSqliteDbHealthy } from '@/lib/backup/pending-db-restore'

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
    expect(fs.readFileSync(`${dbp()}.pre-restore-${ts}-wal`, 'utf8')).toBe('w')
    expect(fs.readFileSync(`${dbp()}.pre-restore-${ts}-shm`, 'utf8')).toBe('s')
  })
  it('舊資料在未 checkpoint 的 WAL 裡：pre-restore 複本可直接打開並看到資料', () => {
    // 重現實機：舊行程關機時沒關 DB 連線，資料全在 -wal，主檔只有表頭頁
    const srcDir = path.join(dir, 'src'); fs.mkdirSync(srcDir)
    const liveDir = path.join(dir, 'live'); fs.mkdirSync(liveDir)
    const src = path.join(srcDir, 'db.sqlite')
    const live = path.join(liveDir, 'db.sqlite')
    const conn = new Database(src)
    conn.pragma('journal_mode = WAL'); conn.pragma('wal_autocheckpoint = 0')
    conn.exec('CREATE TABLE old_t (v TEXT)')
    for (const v of ['a', 'b', 'c']) conn.prepare('INSERT INTO old_t VALUES (?)').run(v)
    // 不關連線就複製（關閉會 checkpoint）
    for (const suf of ['', '-wal', '-shm']) fs.copyFileSync(src + suf, live + suf)
    conn.close()
    expect(fs.statSync(live + '-wal').size).toBeGreaterThan(0)
    makeDb(live + '.restore-pending', 'new')

    const now = new Date()
    const ts = now.toISOString().replace(/[:.]/g, '-')
    expect(applyPendingDbRestore(live, fs, now)).toBe('applied')

    const saved = `${live}.pre-restore-${ts}`
    expect(fs.existsSync(`${saved}-wal`)).toBe(true)
    expect(fs.existsSync(`${saved}-shm`)).toBe(true)
    expect(fs.existsSync(`${live}-wal.pre-restore-${ts}`)).toBe(false)
    expect(fs.existsSync(`${live}-shm.pre-restore-${ts}`)).toBe(false)
    // 讀寫模式開啟：SQLite 需要讀寫 -shm 才能帶入 WAL
    const old = new Database(saved)
    expect(old.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    old.close()

    expect(fs.existsSync(live + '-wal')).toBe(false)
    const cur = new Database(live, { readonly: true })
    expect(cur.prepare('SELECT v FROM t').all()).toEqual([{ v: 'new' }])
    cur.close()
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
      ...fs,
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

describe('快照到套用的完整流程', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  it('快照為 delete 模式，stage + apply 後不留 restore-pending 檔', async () => {
    const live = new Database(dbp())
    live.pragma('journal_mode = WAL'); live.pragma('wal_autocheckpoint = 0')
    live.exec('CREATE TABLE t (v TEXT)'); live.prepare('INSERT INTO t VALUES (?)').run('flow')
    const snap = path.join(dir, 'snap.sqlite')
    await snapshotMccDb(dbp(), snap)
    live.close()
    const chk = new Database(snap, { readonly: true })
    expect(chk.pragma('journal_mode', { simple: true })).toBe('delete')
    chk.close()
    expect(fs.existsSync(snap + '-wal')).toBe(false)
    expect(fs.existsSync(snap + '-shm')).toBe(false)
    stagePendingDbRestore(snap, dbp())
    expect(applyPendingDbRestore(dbp())).toBe('applied')
    expect(fs.readdirSync(dir).filter(f => f.includes('restore-pending'))).toEqual([])
    const d = new Database(dbp(), { readonly: true })
    expect(d.prepare('SELECT v FROM t').all()).toEqual([{ v: 'flow' }])
    d.close()
  })
  it('apply 會清掉 pending 旁殘留的 -wal/-shm', () => {
    makeDb(dbp() + '.restore-pending')
    fs.writeFileSync(dbp() + '.restore-pending-wal', 'junk')
    fs.writeFileSync(dbp() + '.restore-pending-shm', 'junk')
    expect(applyPendingDbRestore(dbp())).toBe('applied')
    expect(fs.readdirSync(dir).filter(f => f.includes('restore-pending'))).toEqual([])
  })
  it('stage 走 tmp + rename：rename 失敗時沒有 pending，tmp 被清掉', () => {
    const snap = path.join(dir, 'snap'); makeDb(snap)
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename boom') })
    try {
      expect(() => stagePendingDbRestore(snap, dbp())).toThrow('rename boom')
    } finally { spy.mockRestore() }
    expect(fs.readdirSync(dir).filter(f => f.includes('restore-pending'))).toEqual([])
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
  it('M1：套用中途意外出錯不丟出（不可讓開機 crash-loop）：pending 移到 .restore-rejected-、記 error、現行 db 保留', () => {
    const dbp = path.join(dir, 'db.sqlite')
    makeDb(dbp, 'keep'); makeDb(dbp + '.restore-pending', 'new')
    const realRename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === dbp && String(from).endsWith('.restore-pending')) throw new Error('EBUSY: rename failed')
      return realRename(from, to)
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try {
      expect(() => { r = applyPendingDbRestoreOnce(dbp) }).not.toThrow()
    } finally { spy.mockRestore() }
    expect(r).toBe('error')
    expect(err).toHaveBeenCalled(); err.mockRestore()
    expect(fs.existsSync(dbp + '.restore-pending')).toBe(false)
    const rejected = fs.readdirSync(dir).filter(f => f.startsWith('db.sqlite.restore-rejected-'))
    expect(rejected).toHaveLength(1)
    const d = new Database(dbp, { readonly: true })
    expect(d.prepare('SELECT v FROM t').all()).toEqual([{ v: 'keep' }]); d.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.result).toBe('error')
    expect(j.detail).toContain('EBUSY')
    expect(j.detail).toContain(rejected[0])
  })
  it('M1：連 pending 都移不走也不丟出，仍記 error', () => {
    const dbp = path.join(dir, 'db.sqlite')
    makeDb(dbp, 'keep'); makeDb(dbp + '.restore-pending', 'new')
    const realRename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).includes('restore-pending')) throw new Error('EROFS')
      return realRename(from, to)
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try {
      expect(() => { r = applyPendingDbRestoreOnce(dbp) }).not.toThrow()
    } finally { spy.mockRestore(); err.mockRestore() }
    expect(r).toBe('error')
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.result).toBe('error')
    expect(j.detail).toContain('EROFS')
  })
})

import { PENDING_MAX_AGE_MS, writeLastDbRestore } from '@/lib/backup/pending-db-restore'
import { preparePendingDbRestore, commitPendingDbRestore, discardPreparedDbRestore, discardPendingDbRestore } from '@/lib/backup/mcc-state'

describe('pending 過期（延遲引信）', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  const ago = (ms: number) => { const t = new Date(Date.now() - ms); fs.utimesSync(dbp() + '.restore-pending', t, t) }
  it('超過 1 小時：拒絕、改名 .restore-rejected-、現行 db 不動、report 說明原因', () => {
    makeDb(dbp(), 'keep'); makeDb(dbp() + '.restore-pending', 'new'); ago(PENDING_MAX_AGE_MS + 60_000)
    const report: { detail?: string } = {}
    expect(applyPendingDbRestore(dbp(), fs, new Date(), report)).toBe('rejected')
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
    expect(fs.readdirSync(dir).some(f => f.startsWith('db.sqlite.restore-rejected-'))).toBe(true)
    const d = new Database(dbp(), { readonly: true })
    expect(d.prepare('SELECT v FROM t').all()).toEqual([{ v: 'keep' }]); d.close()
    expect(report.detail).toContain('超過 1 小時')
  })
  it('未滿 1 小時：照常套用', () => {
    makeDb(dbp(), 'old'); makeDb(dbp() + '.restore-pending', 'new'); ago(PENDING_MAX_AGE_MS - 5 * 60_000)
    expect(applyPendingDbRestore(dbp())).toBe('applied')
  })
  it('now 可注入：同一個檔案在未來時間點就過期', () => {
    makeDb(dbp(), 'old'); makeDb(dbp() + '.restore-pending', 'new')
    expect(applyPendingDbRestore(dbp(), fs, new Date(Date.now() + 2 * 3600_000))).toBe('rejected')
  })
})

describe('last-db-restore.json（開機套用結果）', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
  it('applied 寫入 result/at/detail', () => {
    makeDb(dbp(), 'old'); makeDb(dbp() + '.restore-pending', 'new')
    expect(applyPendingDbRestoreOnce(dbp())).toBe('applied')
    const j = read()
    expect(j.result).toBe('applied'); expect(j.detail).toContain('pre-restore'); expect(Date.parse(j.at)).not.toBeNaN()
  })
  it('rejected（損毀）寫入原因', () => {
    makeDb(dbp(), 'old'); fs.writeFileSync(dbp() + '.restore-pending', 'garbage'.repeat(500))
    expect(applyPendingDbRestoreOnce(dbp())).toBe('rejected')
    expect(read().result).toBe('rejected'); expect(read().detail).toContain('完整性')
  })
  it('寫入用 tmp + rename：不留 .tmp，且覆寫舊內容', () => {
    writeLastDbRestore(dbp(), 'error', 'first'); writeLastDbRestore(dbp(), 'applied', 'second')
    expect(read().detail).toBe('second')
    expect(fs.readdirSync(dir).some(f => f.endsWith('.tmp'))).toBe(false)
  })
  it('沒有 pending 不寫檔', () => {
    makeDb(dbp(), 'old')
    expect(applyPendingDbRestoreOnce(dbp())).toBe('none')
    expect(fs.existsSync(path.join(dir, 'last-db-restore.json'))).toBe(false)
  })
  it('writeLastDbRestore 記錄 error；目錄不存在時不丟錯', () => {
    writeLastDbRestore(dbp(), 'error', 'boom')
    expect(read()).toMatchObject({ result: 'error', detail: 'boom' })
    expect(() => writeLastDbRestore('/nonexistent/x/db.sqlite', 'error', 'x')).not.toThrow()
  })
})

describe('prepare / commit 兩段式', () => {
  const dbp = () => path.join(dir, 'db.sqlite')
  it('prepare 只產生 .tmp（不產生 pending），commit 才 rename，mtime 為現在', () => {
    const snap = path.join(dir, 'snap'); makeDb(snap)
    preparePendingDbRestore(snap, dbp())
    expect(fs.existsSync(dbp() + '.restore-pending.tmp')).toBe(true)
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
    const old = new Date(Date.now() - 3 * 3600_000); fs.utimesSync(dbp() + '.restore-pending.tmp', old, old)
    commitPendingDbRestore(dbp())
    expect(fs.existsSync(dbp() + '.restore-pending.tmp')).toBe(false)
    expect(Date.now() - fs.statSync(dbp() + '.restore-pending').mtimeMs).toBeLessThan(60_000)
    expect(fs.statSync(dbp() + '.restore-pending').mode & 0o777).toBe(0o600)
  })
  it('prepare 拒絕損毀快照且不留 .tmp；discard 系列', () => {
    const snap = path.join(dir, 'snap'); fs.writeFileSync(snap, 'x'.repeat(2000))
    expect(() => preparePendingDbRestore(snap, dbp())).toThrow(/完整性/)
    expect(fs.readdirSync(dir).some(f => f.includes('restore-pending'))).toBe(false)
    const good = path.join(dir, 'good'); makeDb(good); preparePendingDbRestore(good, dbp()); discardPreparedDbRestore(dbp())
    expect(fs.existsSync(dbp() + '.restore-pending.tmp')).toBe(false)
    stagePendingDbRestore(good, dbp()); discardPendingDbRestore(dbp())
    expect(fs.existsSync(dbp() + '.restore-pending')).toBe(false)
  })
})

describe('markBackupRowInSnapshot', () => {
  // 備份檔內的資料庫快照是在備份進行中拍的，所以這筆備份自己的 backup_logs 是 processing；
  // 還原後啟動時會被修復成「中斷」的 failed（實測 2026-10-09：每次還原都多一筆假的失敗）。
  // 能被拿來還原就代表這個備份檔存在，所以快照內應記為 completed 並指向它。
  it('把快照內該筆 processing 改為 completed 並記下最終路徑，其他列不動', () => {
    const snap = path.join(dir, 'snap.sqlite')
    const db = new Database(snap)
    db.exec(`CREATE TABLE backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER, file_size INTEGER, file_path TEXT,
      extra_file_paths TEXT, destination TEXT, notes TEXT, error TEXT)`)
    db.prepare("INSERT INTO backup_logs (status) VALUES ('completed')").run()
    db.prepare("INSERT INTO backup_logs (status) VALUES ('processing')").run()
    db.close()

    markBackupRowInSnapshot(snap, 2, '/b/mcc-backup_x.tar.gz', 1791535407)

    const r = new Database(snap, { readonly: true })
    const rows = r.prepare('SELECT id, status, file_path, completed_at, error FROM backup_logs ORDER BY id').all()
    r.close()
    expect(rows).toEqual([
      { id: 1, status: 'completed', file_path: null, completed_at: null, error: null },
      { id: 2, status: 'completed', file_path: '/b/mcc-backup_x.tar.gz', completed_at: 1791535407, error: null },
    ])
  })
})

describe('還原時補上快照當下未知的 backup_logs 欄位', () => {
  const BACKUP_LOGS = `CREATE TABLE backup_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    started_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER, file_size INTEGER,
    file_path TEXT, extra_file_paths TEXT, destination TEXT, notes TEXT, error TEXT)`
  const NAME = 'mcc-backup_openclaw_h1_20261006_000000.tar.gz'
  type Row = { id: number; status: string; file_path: string | null; file_size: number | null; completed_at: number | null; extra_file_paths?: string | null; error?: string | null }
  function makeLogsDb(file: string, rows: Row[]) {
    const d = new Database(file)
    d.exec(BACKUP_LOGS)
    const ins = d.prepare('INSERT INTO backup_logs (id, status, file_path, file_size, completed_at, extra_file_paths, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const r of rows) ins.run(r.id, r.status, r.file_path, r.file_size, r.completed_at, r.extra_file_paths ?? null, r.error ?? null)
    return d
  }
  const rowOf = (file: string, id: number) => {
    const d = new Database(file, { readonly: true })
    try { return d.prepare('SELECT * FROM backup_logs WHERE id = ?').get(id) as Record<string, unknown> } finally { d.close() }
  }

  it('現行 DB 有同一份備份的完成紀錄：還原後 file_size、extra、警告、完成時間與現行一致', () => {
    const archive = path.join(dir, NAME)
    fs.writeFileSync(archive, Buffer.alloc(777))
    const live = path.join(dir, 'db.sqlite')
    const liveConn = makeLogsDb(live, [
      { id: 4, status: 'completed', file_path: path.join(dir, 'older.tar.gz'), file_size: 999, completed_at: 50 },
      { id: 5, status: 'completed', file_path: archive, file_size: 12345, completed_at: 200, extra_file_paths: '["/b/x.tar.gz"]', error: '有警告' },
    ])
    liveConn.pragma('journal_mode = WAL') // 現行 DB 是 WAL 模式、連線仍開著
    // 快照：這筆備份已被 markBackupRowInSnapshot 標成 completed，但打包前還不知道大小
    const snap = path.join(dir, 'snap.sqlite')
    makeLogsDb(snap, [
      { id: 4, status: 'completed', file_path: path.join(dir, 'older.tar.gz'), file_size: 999, completed_at: 50 },
      { id: 5, status: 'completed', file_path: archive, file_size: null, completed_at: 100 },
    ]).close()

    stagePendingDbRestore(snap, live, archive)
    liveConn.close()
    expect(applyPendingDbRestore(live)).toBe('applied')

    expect(rowOf(live, 5)).toMatchObject({ file_size: 12345, extra_file_paths: '["/b/x.tar.gz"]', error: '有警告', completed_at: 200 })
    expect(rowOf(live, 4)).toMatchObject({ file_size: 999, completed_at: 50 })
  })

  it('現行 DB 沒有這筆（從別台機器帶來的備份、檔案已搬移）：用封存檔本身的大小補 file_size', () => {
    const elsewhere = path.join(dir, 'uploaded'); fs.mkdirSync(elsewhere)
    const archive = path.join(elsewhere, NAME)
    fs.writeFileSync(archive, Buffer.alloc(777))
    const live = path.join(dir, 'db.sqlite')
    makeLogsDb(live, []).close()
    const snap = path.join(dir, 'snap.sqlite')
    makeLogsDb(snap, [{ id: 5, status: 'completed', file_path: `/old/host/backups/${NAME}`, file_size: null, completed_at: 100 }]).close()

    stagePendingDbRestore(snap, live, archive)
    expect(applyPendingDbRestore(live)).toBe('applied')

    expect(rowOf(live, 5)).toMatchObject({ file_size: 777, completed_at: 100 })
  })

  it('修補後的待還原檔仍通過完整性檢查、不留 -wal/-journal、權限 600', () => {
    const archive = path.join(dir, NAME)
    fs.writeFileSync(archive, Buffer.alloc(10))
    const live = path.join(dir, 'db.sqlite')
    makeLogsDb(live, []).close()
    const snap = path.join(dir, 'snap.sqlite')
    makeLogsDb(snap, [{ id: 5, status: 'completed', file_path: archive, file_size: null, completed_at: 100 }]).close()

    stagePendingDbRestore(snap, live, archive)
    const pending = `${live}.restore-pending`
    expect(rowOf(pending, 5)).toMatchObject({ file_size: 10 })
    expect(isSqliteDbHealthy(pending)).toBe(true)
    for (const s of ['-wal', '-shm', '-journal']) expect(fs.existsSync(pending + s)).toBe(false)
    expect(fs.statSync(pending).mode & 0o777).toBe(0o600)
  })

  it('補大小後檔案若不健康：待還原檔退回未修補的快照，還原照常套用，並留一行錯誤紀錄', () => {
    const archive = path.join(dir, NAME)
    fs.writeFileSync(archive, Buffer.alloc(10))
    const live = path.join(dir, 'db.sqlite')
    makeLogsDb(live, []).close()
    const snap = path.join(dir, 'snap.sqlite')
    makeLogsDb(snap, [{ id: 5, status: 'completed', file_path: archive, file_size: null, completed_at: 100 }]).close()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    preparePendingDbRestore(snap, live, archive, (target) => { fs.writeFileSync(target, 'not a database'.repeat(100)) })
    commitPendingDbRestore(live)

    expect(fs.readFileSync(`${live}.restore-pending`)).toEqual(fs.readFileSync(snap))
    expect(fs.readdirSync(dir).filter((n) => n.includes('.restore-pending.'))).toEqual([])
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[Backup]'), expect.anything())
    errSpy.mockRestore()
    expect(applyPendingDbRestore(live)).toBe('applied')
    expect(rowOf(live, 5)).toMatchObject({ file_size: null, completed_at: 100 })
  })

  it('補大小丟錯：不影響還原、留一行錯誤紀錄（不再靜默）', () => {
    const archive = path.join(dir, NAME)
    fs.writeFileSync(archive, 'x')
    const live = path.join(dir, 'db.sqlite'); makeDb(live)
    const snap = path.join(dir, 'snap.sqlite'); makeDb(snap, 'from-backup')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => preparePendingDbRestore(snap, live, archive, () => { throw new Error('boom') })).not.toThrow()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[Backup]'), expect.anything())
    errSpy.mockRestore()
    expect(fs.readFileSync(`${live}.restore-pending.tmp`)).toEqual(fs.readFileSync(snap))
    expect(fs.readdirSync(dir).filter((n) => n.includes('.restore-pending.tmp.'))).toEqual([])
  })

  it('快照裡沒有 backup_logs 表（非預期格式）時不影響還原排程', () => {
    const archive = path.join(dir, NAME)
    fs.writeFileSync(archive, 'x')
    const live = path.join(dir, 'db.sqlite'); makeDb(live)
    const snap = path.join(dir, 'snap.sqlite'); makeDb(snap, 'from-backup')
    expect(() => stagePendingDbRestore(snap, live, archive)).not.toThrow()
    expect(fs.existsSync(`${live}.restore-pending`)).toBe(true)
  })
})

describe('M1 後續：套用失敗且回滾也失敗時，不可讓 MCC 默默以空資料庫開機', () => {
  /** 建一個舊資料都還在未 checkpoint 的 -wal 裡的 live db（重現實機：關機沒關連線） */
  function makeLiveWalDb(live: string) {
    const srcDir = path.join(dir, 'src'); fs.mkdirSync(srcDir)
    const src = path.join(srcDir, 'db.sqlite')
    const conn = new Database(src)
    conn.pragma('journal_mode = WAL'); conn.pragma('wal_autocheckpoint = 0')
    conn.exec('CREATE TABLE old_t (v TEXT)')
    for (const v of ['a', 'b', 'c']) conn.prepare('INSERT INTO old_t VALUES (?)').run(v)
    for (const suf of ['', '-wal', '-shm']) fs.copyFileSync(src + suf, live + suf)
    conn.close()
  }
  /** pending → db 一律失敗；pre-restore → db 的 rename 依 failRestoreBack 決定；failOther 可讓其他 rename 失敗 */
  function failingFs(
    dbp: string,
    failRestoreBack: (from: string, attempt: number) => boolean,
    failOther: (from: string, to: string) => boolean = () => false,
  ) {
    const attempts = new Map<string, number>()
    return {
      ...fs,
      readdirSync: vi.fn(fs.readdirSync),
      rmSync: vi.fn(fs.rmSync),
      copyFileSync: vi.fn(fs.copyFileSync),
      renameSync: (a: string, b: string) => {
        if (b === dbp && a.endsWith('.restore-pending')) throw new Error('ENOSPC: no space left on device')
        if (failOther(a, b)) throw new Error(`EIO: rename ${path.basename(a)} failed`)
        if (a.includes('.pre-restore-')) {
          const n = (attempts.get(a) ?? 0) + 1
          attempts.set(a, n)
          if (failRestoreBack(a, n)) throw new Error(`EIO: rename ${path.basename(a)} failed`)
        }
        fs.renameSync(a, b)
      },
    } as unknown as typeof fs
  }

  it('回滾失敗後自動把 pre-restore 複本（含 -wal/-shm）搬回 db.sqlite，資料可讀，detail 說明搬回了哪個檔', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    // 第一次（applyPendingDbRestore 內的回滾）失敗，之後（自救）成功
    const fsImpl = failingFs(live, (_a, n) => n === 1)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try {
      expect(() => { r = applyPendingDbRestoreOnce(live, fsImpl, now) }).not.toThrow()
    } finally { err.mockRestore() }
    expect(r).toBe('error')
    expect(fs.existsSync(live)).toBe(true)
    for (const suf of ['', '-wal', '-shm']) expect(fs.existsSync(saved + suf)).toBe(false)
    const d = new Database(live)
    expect(d.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    d.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.result).toBe('error')
    expect(j.detail).toContain('ENOSPC')
    expect(j.detail).toContain(`已自動把 ${saved} 搬回`)
    // m2：自救已讓檔案歸位，不可再列「未能移回」，使用者會以為還有檔案沒歸位
    expect(j.detail).not.toContain('回滾時未能移回的檔案')
  })

  it('搬回也失敗：detail 明講將以空資料庫啟動、資料仍在哪個 pre-restore 路徑、要手動搬回', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    const fsImpl = failingFs(live, () => true)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try {
      expect(() => { r = applyPendingDbRestoreOnce(live, fsImpl, now) }).not.toThrow()
    } finally { err.mockRestore() }
    expect(r).toBe('error')
    expect(fs.existsSync(live)).toBe(false)
    // 資料仍完整留在複本
    const old = new Database(saved)
    expect(old.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    old.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.result).toBe('error')
    expect(j.detail).toContain('MCC 將以空資料庫啟動')
    expect(j.detail).toContain(`你的資料仍在 ${saved}`)
    expect(j.detail).toContain('請手動搬回')
    expect(j.detail).toContain('EIO')
    expect(j.detail).not.toContain('繼續使用現行資料庫開機')
  })

  it('回滾只有 -wal 失敗（主檔已移回）：自救補搬 -wal，WAL 內的資料不會被默默丟掉', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    const fsImpl = failingFs(live, (a, n) => a.endsWith('-wal') && n === 1)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    expect(fs.existsSync(`${saved}-wal`)).toBe(false)
    const d = new Database(live)
    expect(d.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    d.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain(`已自動把 ${saved} 搬回`)
    expect(j.detail).not.toContain('回滾時未能移回的檔案')
  })

  it('本次搬走的那組優先於字串上更新的別組（時鐘回撥留下的未來時戳誘餌）', () => {
    const live = path.join(dir, 'db.sqlite')
    const decoy = `${live}.pre-restore-2027-01-01T00-00-00-000Z`
    makeDb(decoy, 'decoy')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const fsImpl = failingFs(live, (_a, n) => n === 1)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    const d = new Database(live)
    expect(d.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    d.close()
    expect(fs.existsSync(decoy)).toBe(true)
  })

  it('本次沒搬任何檔、db.sqlite 不存在（上次開機搬走後當機）：挑最新一組（含 -wal）搬回，舊的那組與非主檔名不動', () => {
    const live = path.join(dir, 'db.sqlite')
    const t0 = `${live}.pre-restore-2026-09-01T00-00-00-000Z`
    const t1 = `${live}.pre-restore-2026-10-12T00-00-00-000Z`
    makeDb(t0, 'older')
    makeLiveWalDb(live)
    for (const suf of ['', '-wal', '-shm']) fs.renameSync(live + suf, t1 + suf)
    // 不是 pre-restore 主檔名的干擾檔：字串上比 t1 新，但不可被選中
    fs.writeFileSync(`${live}.pre-restore-zzz`, 'junk')
    fs.writeFileSync(`${live}.restore-rejected-2027-01-01T00-00-00-000Z`, 'junk')
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const fsImpl = failingFs(live, () => false)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try { r = applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    expect(r).toBe('error')
    // m3：走注入的 fsImpl
    expect(fsImpl.readdirSync).toHaveBeenCalled()
    for (const suf of ['', '-wal', '-shm']) expect(fs.existsSync(t1 + suf)).toBe(false)
    const d = new Database(live)
    expect(d.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    d.close()
    expect(fs.existsSync(t0)).toBe(true)
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain(`已自動把 ${t1} 搬回`)
  })

  it('I1：主檔搬不回、-wal/-shm 卻已被回滾放回 db.sqlite-wal：要把日誌搬回複本旁，否則新空庫第一次寫入就清掉舊 WAL', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    // 只有主檔的 rename（回滾與自救）一律失敗；-wal/-shm 回滾成功
    const fsImpl = failingFs(live, (a) => a === saved)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try { r = applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    expect(r).toBe('error')
    expect(fs.existsSync(live)).toBe(false)
    expect(fs.existsSync(`${saved}-wal`)).toBe(true)
    expect(fs.existsSync(`${live}-wal`)).toBe(false)
    // 模擬 db.ts：建出空庫、開 WAL、寫入
    const fresh = new Database(live)
    fresh.pragma('journal_mode = WAL')
    fresh.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
    fresh.prepare('INSERT INTO settings VALUES (?, ?)').run('k', 'v')
    fresh.close()
    const old = new Database(saved)
    expect(old.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    old.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain('MCC 將以空資料庫啟動')
    expect(j.detail).toContain(`你的資料仍在 ${saved}`)
    expect(j.detail).toContain(`${saved}-wal`)
  })

  it('I1：日誌也搬不回複本旁：detail 依實際位置指出 WAL 仍在 db.sqlite-wal、要立即停止 MCC', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    const fsImpl = failingFs(live, (a) => a === saved, (a, b) => a === `${live}-wal` && b === `${saved}-wal`)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    expect(fs.existsSync(`${live}-wal`)).toBe(true)
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain(`${live}-wal`)
    expect(j.detail).toContain('立即停止 MCC')
    expect(j.detail).not.toContain('連同同名的 -wal/-shm')
  })

  it('m1：主檔搬回但 -wal 搬不回：先把主檔複製一份留在複本位置，保留完整的「主檔＋WAL」配對；不叫使用者把舊 -wal 改名換回', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    // 回滾全失敗；自救時主檔與 -shm 成功、-wal 一律失敗
    const fsImpl = failingFs(live, (a, n) => n === 1 || a === `${saved}-wal`)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    expect(fs.existsSync(live)).toBe(true)
    expect(fs.existsSync(saved)).toBe(true)
    expect(fs.existsSync(`${saved}-wal`)).toBe(true)
    // 模擬 MCC 用缺 WAL 的主檔開機並寫入
    const cur = new Database(live)
    cur.pragma('journal_mode = WAL')
    cur.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
    cur.close()
    const pair = new Database(saved)
    expect(pair.prepare('SELECT v FROM old_t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }, { v: 'c' }])
    pair.close()
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain(`${saved}-wal`)
    expect(j.detail).toContain('整組')
    expect(j.detail).not.toContain('手動改名再重啟')
  })

  it('N1：m1 情境重建出複本主檔後，detail 不可再把主檔列成「回滾時未能移回」（原位置已有檔案）', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    const fsImpl = failingFs(live, (a, n) => n === 1 || a === `${saved}-wal`)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { applyPendingDbRestoreOnce(live, fsImpl, now) } finally { err.mockRestore() }
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain(`已自動把 ${saved} 搬回`)
    // 主檔已歸位（只是又被複製出一份配對），不可列成未移回；-wal 確實還在複本旁，可以列
    expect(j.detail).not.toContain(`${saved} → ${live}：`)
  })

  it('N2：保留完整配對的複製不覆寫既有複本主檔（COPYFILE_EXCL）；EEXIST 時不丟出、detail 說明', () => {
    const live = path.join(dir, 'db.sqlite')
    makeLiveWalDb(live)
    makeDb(live + '.restore-pending', 'new')
    const now = new Date('2026-10-13T01:02:03.456Z')
    const saved = `${live}.pre-restore-2026-10-13T01-02-03-456Z`
    const fsImpl = failingFs(live, (a, n) => n === 1 || a === `${saved}-wal`)
    const modes: unknown[] = []
    ;(fsImpl as any).copyFileSync = (a: string, b: string, mode?: number) => {
      modes.push(mode)
      fs.writeFileSync(b, 'someone else') // 複製前複本位置被佔用
      return fs.copyFileSync(a, b, mode)
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let r: string | undefined
    try {
      expect(() => { r = applyPendingDbRestoreOnce(live, fsImpl, now) }).not.toThrow()
    } finally { err.mockRestore() }
    expect(r).toBe('error')
    expect(modes).toEqual([fs.constants.COPYFILE_EXCL])
    expect(fs.readFileSync(saved, 'utf8')).toBe('someone else')
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.detail).toContain('EEXIST')
    expect(j.detail).toContain('未覆寫')
  })

  it('m3：pending 旁殘留 -wal/-shm 的清理走注入的 fsImpl', () => {
    const live = path.join(dir, 'db.sqlite')
    makeDb(live, 'keep')
    makeDb(live + '.restore-pending', 'new')
    fs.writeFileSync(live + '.restore-pending-wal', '')
    const fsImpl = { ...fs, rmSync: vi.fn(fs.rmSync) } as unknown as typeof fs
    expect(applyPendingDbRestore(live, fsImpl)).toBe('applied')
    expect((fsImpl.rmSync as any).mock.calls.map((c: unknown[]) => c[0])).toContain(live + '.restore-pending-wal')
  })
})

describe('M4：還原回來的資料庫帶著「舊 cron 已清理」旗標時，套用後要清掉，讓開機再掃一次', () => {
  const KEY = 'backup.legacyCronCleaned'
  function makeMccDb(file: string, flag: string | null) {
    const d = new Database(file)
    d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    d.prepare('INSERT INTO settings VALUES (?, ?)').run('other', 'keep')
    if (flag !== null) d.prepare('INSERT INTO settings VALUES (?, ?)').run(KEY, flag)
    d.close()
  }
  const readFlag = (file: string) => {
    const d = new Database(file, { readonly: true })
    try {
      return (d.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined)?.value
    } finally { d.close() }
  }

  it('旗標為已清理（1）→ applied 後旗標被清掉（開機的 cleanLegacyBackupCron 因此會重新 list）、其他設定不動', () => {
    const dbp = path.join(dir, 'db.sqlite')
    makeMccDb(dbp, '1')
    makeMccDb(dbp + '.restore-pending', '1')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('applied')
    expect(readFlag(dbp)).toBeUndefined()
    const d = new Database(dbp, { readonly: true })
    expect(d.prepare('SELECT value FROM settings WHERE key = ?').get('other')).toEqual({ value: 'keep' })
    d.close()
    expect(isSqliteDbHealthy(dbp)).toBe(true)
    expect(fs.existsSync(dbp + '-wal')).toBe(false)
  })
  it('沒有 settings 表（非預期格式）或沒有旗標：照常 applied，不出錯', () => {
    const dbp = path.join(dir, 'db.sqlite')
    makeDb(dbp + '.restore-pending', 'new')
    expect(applyPendingDbRestoreOnce(dbp)).toBe('applied')
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'last-db-restore.json'), 'utf8'))
    expect(j.result).toBe('applied')
    delete (globalThis as any).__mccPendingDbRestoreChecked
    const dbp2 = path.join(dir, 'db2.sqlite')
    makeMccDb(dbp2 + '.restore-pending', null)
    expect(applyPendingDbRestoreOnce(dbp2)).toBe('applied')
    expect(readFlag(dbp2)).toBeUndefined()
  })
})
