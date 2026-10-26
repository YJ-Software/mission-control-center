import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const m = vi.hoisted(() => ({ mode: 'hang' as 'hang' | 'ok' | 'selfkill' | 'trap143' }))
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  return {
    ...actual,
    spawn: () => {
      const child: any = new EventEmitter()
      child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
      child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
      // trap143：真正的 openclaw 是 node 包裝器，收到 SIGTERM 會轉給子行程、自己以 exit 143 結束（code 不是 null）
      child.kill = (sig: string) => {
        setTimeout(() => (m.mode === 'trap143' ? child.emit('close', 143, null) : child.emit('close', null, sig)), 0)
        return true
      }
      if (m.mode === 'ok') setTimeout(() => child.emit('close', 0, null), 0)
      if (m.mode === 'selfkill') setTimeout(() => child.emit('close', null, 'SIGKILL'), 0)
      return child
    },
  }
})

import { runOpenclaw } from '@/lib/openclaw/models-config'
import { getBackupAvailability, resetBackupAvailabilityCache } from '@/lib/backup/availability'

beforeEach(() => { m.mode = 'hang'; resetBackupAvailabilityCache() })

describe('runOpenclaw 被訊號終止', () => {
  it('逾時 → code 124 並註明 timed out', async () => {
    const r = await runOpenclaw(['backup', '--help'], 30)
    expect(r.code).toBe(124)
    expect(r.stderr).toContain('timed out after 30ms')
  })
  it('逾時後包裝器自己以 exit 143 結束 → 仍是 124 並註明 timed out（2026-10-26 實機：原因欄是空的）', async () => {
    m.mode = 'trap143'
    const r = await runOpenclaw(['backup', 'create'], 30)
    expect(r.code).toBe(124)
    expect(r.stderr).toContain('timed out after 30ms')
  })
  it('非逾時被訊號殺掉 → 非 0 並帶訊號名', async () => {
    m.mode = 'selfkill'
    const r = await runOpenclaw(['x'], 5000)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('SIGKILL')
  })
  it('正常 exit 0 不受影響', async () => {
    m.mode = 'ok'
    expect((await runOpenclaw(['x'], 5000)).code).toBe(0)
  })
})

describe('availability 遇到逾時', () => {
  it('回不可用並快取（60 秒內不重探）', async () => {
    const run = vi.fn((a: string[], t: number) => runOpenclaw(a, 30))
    const r1 = await getBackupAvailability({ run, now: () => 0 })
    expect(r1.available).toBe(false)
    expect(r1.reason).toContain('timed out')
    await getBackupAvailability({ run, now: () => 1000 })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
