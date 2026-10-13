import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { registerDbConnection, closeDb } from '@/lib/db-close'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-db-close-')) })
afterEach(() => {
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

function openWal(file: string) {
  const conn = new Database(file)
  conn.pragma('journal_mode = WAL')
  conn.pragma('wal_autocheckpoint = 0') // 模擬資料全留在 WAL 的情況
  conn.exec('CREATE TABLE t (v TEXT)')
  conn.prepare('INSERT INTO t VALUES (?)').run('hello')
  return conn
}

describe('closeDb', () => {
  it('關閉已登記的連線：WAL 被 checkpoint 回主檔，-wal/-shm 移除', () => {
    const file = path.join(dir, 'db.sqlite')
    const conn = openWal(file)
    registerDbConnection(conn)
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0)

    closeDb()

    expect(conn.open).toBe(false)
    expect(fs.existsSync(`${file}-wal`)).toBe(false)
    expect(fs.existsSync(`${file}-shm`)).toBe(false)
    const check = new Database(file, { readonly: true })
    expect(check.prepare('SELECT v FROM t').all()).toEqual([{ v: 'hello' }])
    check.close()
  })

  it('同一行程載入兩份 db.ts（server.ts 與 Next bundle）時兩條連線都會關閉，WAL 才會真的被清掉', () => {
    const file = path.join(dir, 'db.sqlite')
    const a = openWal(file)
    const b = new Database(file)
    registerDbConnection(a)
    registerDbConnection(b)

    closeDb()

    expect(a.open).toBe(false)
    expect(b.open).toBe(false)
    expect(fs.existsSync(`${file}-wal`)).toBe(false)
  })

  it('可重複呼叫、已被別處關閉的連線也不丟錯', () => {
    const conn = openWal(path.join(dir, 'db.sqlite'))
    registerDbConnection(conn)
    conn.close()
    expect(() => closeDb()).not.toThrow()
    expect(() => closeDb()).not.toThrow()
  })
})
