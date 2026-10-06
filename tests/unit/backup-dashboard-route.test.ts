import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ avail: vi.fn(), last: vi.fn() }))
const chain: any = { from: () => chain, where: () => chain, get: () => ({ count: 0 }) }
vi.mock('@/lib/db', () => ({ db: { select: () => chain }, initDb: () => {}, DB_PATH: '/x/db.sqlite' }))
vi.mock('@/lib/backup/availability', () => ({ getBackupAvailability: m.avail }))
vi.mock('@/lib/backup/pending-db-restore', () => ({ readLastDbRestore: m.last }))
vi.mock('@/lib/backup/scripts', () => ({ listBackupFiles: () => [], deleteBackupFile: () => {} }))
vi.mock('@/lib/backup/helpers', () => ({
  getOrCreateBackupToken: () => 'tok', formatBytes: () => '0 B', getAllBackupDirs: () => [],
}))

import { GET } from '@/app/api/backup/route'

const get = () => GET(new NextRequest('http://mcc.local/api/backup?type=dashboard'))

beforeEach(() => {
  m.avail.mockReset().mockResolvedValue({ available: false, reason: 'no backup cmd' })
  m.last.mockReset().mockReturnValue(null)
})

describe('GET /api/backup?type=dashboard', () => {
  it('回 backupAvailable/backupMissingReason/lastDbRestore，不再有 scriptsAvailable', async () => {
    const j = await (await get()).json()
    expect(j.backupAvailable).toBe(false)
    expect(j.backupMissingReason).toBe('no backup cmd')
    expect(j.lastDbRestore).toBeNull()
    expect('scriptsAvailable' in j).toBe(false)
  })
  it('帶出 lastDbRestore', async () => {
    const v = { result: 'rejected', at: '2026-10-06T00:00:00Z', detail: 'bad' }
    m.last.mockReturnValue(v)
    expect((await (await get()).json()).lastDbRestore).toEqual(v)
  })
})
