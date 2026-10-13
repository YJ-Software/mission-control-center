import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLastDbRestore, writeLastDbRestore } from '@/lib/backup/pending-db-restore'

let tmp: string, db: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-ldr-')); db = path.join(tmp, 'db.sqlite') })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('readLastDbRestore', () => {
  it('不存在 → null', () => expect(readLastDbRestore(db)).toBeNull())
  it('讀回 writeLastDbRestore 寫的內容', () => {
    writeLastDbRestore(db, 'applied', 'ok', new Date('2026-10-06T00:00:00Z'))
    expect(readLastDbRestore(db)).toEqual({ result: 'applied', at: '2026-10-06T00:00:00.000Z', detail: 'ok' })
  })
  it('error 的長 detail（含路徑與多段說明）原文讀回，不截斷——備份頁橫幅直接顯示全文', () => {
    const detail = '套用待還原資料庫時發生錯誤：ENOSPC；目前資料庫檔不存在，MCC 將以空資料庫啟動；你的資料仍在 ' +
      `${'/home/u/.mission-control/db.sqlite.pre-restore-2026-10-13T01-02-03-456Z'}，請手動搬回後重啟；` + 'x'.repeat(2000)
    writeLastDbRestore(db, 'error', detail, new Date('2026-10-13T00:00:00Z'))
    expect(readLastDbRestore(db)?.detail).toBe(detail)
  })
  it('壞 JSON / 不合法 result → null', () => {
    const f = path.join(tmp, 'last-db-restore.json')
    fs.writeFileSync(f, '{oops'); expect(readLastDbRestore(db)).toBeNull()
    fs.writeFileSync(f, JSON.stringify({ result: 'weird', at: 'x' })); expect(readLastDbRestore(db)).toBeNull()
  })
})
