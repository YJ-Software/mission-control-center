import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBackupAvailability, resetBackupAvailabilityCache } from '@/lib/backup/availability'

beforeEach(() => resetBackupAvailabilityCache())

describe('getBackupAvailability', () => {
  it('exit 0 = 可用，並以 backup --help 探測', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: 'x', stderr: '' })
    expect(await getBackupAvailability({ run, now: () => 0 })).toEqual({ available: true, reason: null })
    expect(run.mock.calls[0][0]).toEqual(['backup', '--help'])
  })
  it('非 0 = 不可用並帶原因', async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'unknown command backup' })
    const r = await getBackupAvailability({ run, now: () => 0 })
    expect(r.available).toBe(false)
    expect(r.reason).toContain('unknown command')
  })
  it('spawn 例外 = 不可用', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    expect((await getBackupAvailability({ run, now: () => 0 })).reason).toBe('ENOENT')
  })
  it('60 秒內用快取，之後重探', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await getBackupAvailability({ run, now: () => 1000 })
    await getBackupAvailability({ run, now: () => 60_000 })
    expect(run).toHaveBeenCalledTimes(1)
    await getBackupAvailability({ run, now: () => 61_001 })
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('in-flight 去重', () => {
  it('並發呼叫共用同一次探測', async () => {
    let release!: (v: { code: number; stdout: string; stderr: string }) => void
    const run = vi.fn(() => new Promise<{ code: number; stdout: string; stderr: string }>(r => { release = r }))
    const a = getBackupAvailability({ run, now: () => 0 })
    const b = getBackupAvailability({ run, now: () => 0 })
    release({ code: 0, stdout: '', stderr: '' })
    expect(await a).toEqual(await b)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
