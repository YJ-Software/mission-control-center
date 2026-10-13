import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// 記憶體 DB 取代 @/lib/db，絕不碰 ~/.mission-control
const h = vi.hoisted(() => ({ holder: {} as { db?: unknown } }))
vi.mock('@/lib/db', () => ({
  get db() { return h.holder.db },
  initDb: () => {},
  DB_PATH: '/nonexistent/db.sqlite',
}))

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as backupSchema from '@/lib/backup/schema'
import { GET, POST, PUT } from '@/app/api/backup/destinations/route'

let sqlite: Database.Database
const SECRET = 'Sup3r-Secret-PW'

function stored(id: string) {
  const r = sqlite.prepare('SELECT config FROM backup_destinations WHERE id = ?').get(id) as { config: string }
  return JSON.parse(r.config)
}
const put = (body: unknown) => PUT(new NextRequest('http://mcc.local/api/backup/destinations', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE backup_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));`)
  sqlite.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES ('f', 'NAS', 'ftp', ?)`)
    .run(JSON.stringify({ ip: '1.2.3.4', port: 21, user: 'bob', password: SECRET, mode: 'passive', path: '/b' }))
  sqlite.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES ('l', 'Local', 'local', '{"path":"~/backup"}')`).run()
  h.holder.db = drizzle(sqlite, { schema: backupSchema })
})

describe('GET /api/backup/destinations（M7：不回傳密碼本文）', () => {
  it('FTP 密碼換成遮罩並帶 hasPassword', async () => {
    const res = await GET()
    const text = await res.text()
    expect(text).not.toContain(SECRET)
    const items = JSON.parse(text) as { id: string; config: string; hasPassword: boolean }[]
    const ftp = items.find(i => i.id === 'f')!
    expect(ftp.hasPassword).toBe(true)
    expect(JSON.parse(ftp.config)).toMatchObject({ ip: '1.2.3.4', user: 'bob', password: '***' })
    const local = items.find(i => i.id === 'l')!
    expect(local.hasPassword).toBe(false)
    expect(JSON.parse(local.config)).toEqual({ path: '~/backup' })
  })
})

describe('PUT /api/backup/destinations：空值或遮罩值不覆蓋既有密碼', () => {
  it('password 為空字串：沿用舊密碼，其他欄位更新', async () => {
    expect((await put({ id: 'f', name: 'NAS2', type: 'ftp', config: { ip: '5.6.7.8', port: 21, user: 'bob', password: '', mode: 'active', path: '/c' } })).status).toBe(200)
    expect(stored('f')).toEqual({ ip: '5.6.7.8', port: 21, user: 'bob', password: SECRET, mode: 'active', path: '/c' })
  })

  it('password 為遮罩值（前端原樣送回）：沿用舊密碼', async () => {
    await put({ id: 'f', config: { ip: '1.2.3.4', port: 21, user: 'bob', password: '***', mode: 'passive', path: '/b' } })
    expect(stored('f').password).toBe(SECRET)
  })

  it('有新密碼：覆蓋', async () => {
    await put({ id: 'f', config: { ip: '1.2.3.4', port: 21, user: 'bob', password: 'n3w', mode: 'passive', path: '/b' } })
    expect(stored('f').password).toBe('n3w')
  })

  it('只切換 enabled（不帶 config）：config 不動', async () => {
    await put({ id: 'f', enabled: 0 })
    expect(stored('f').password).toBe(SECRET)
  })
})

describe('POST /api/backup/destinations', () => {
  it('新建時遮罩值不會被當成密碼存起來', async () => {
    const res = await POST(new NextRequest('http://mcc.local/api/backup/destinations', { method: 'POST', body: JSON.stringify({ name: 'x', type: 'ftp', config: { ip: 'h', user: 'u', password: '***' } }) }))
    const { id } = await res.json()
    expect(stored(id).password).toBeUndefined()
  })
})
