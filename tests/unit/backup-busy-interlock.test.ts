import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ busy: vi.fn(), startJob: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/backup/lock', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/jobs/runner', () => ({ startJob: m.startJob }))
vi.mock('@/lib/upgrade/manager', () => ({
  getInstallInfo: m.info, applyUpgrade: vi.fn(), cleanupTempTarball: vi.fn(),
  downloadArtifact: vi.fn(), scheduleServiceRestart: vi.fn(),
}))

import { POST as action } from '@/app/api/action/route'
import { POST as apply } from '@/app/api/upgrade/apply/route'

const post = (url: string, body: unknown) =>
  new NextRequest(`http://mcc.local${url}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  m.busy.mockReset().mockReturnValue(true)
  m.startJob.mockReset().mockReturnValue({ id: 'j' })
  m.info.mockReset().mockReturnValue({ mode: 'release', service: 's' })
})

describe('備份/還原進行中拒絕重啟與升級', () => {
  for (const a of ['restart-dashboard', 'restart-openclaw', 'update-mcc', 'update-openclaw', 'reboot-system']) {
    it(`/api/action ${a} → 409 且不啟動 job`, async () => {
      const res = await action(post('/api/action', { action: a }))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain('備份或還原進行中')
      expect(m.startJob).not.toHaveBeenCalled()
    })
  }
  it('/api/action restart-dashboard 在沒有備份/還原時照常啟動', async () => {
    m.busy.mockReturnValue(false)
    const res = await action(post('/api/action', { action: 'restart-dashboard' }))
    expect(res.status).toBe(200)
    expect(m.startJob).toHaveBeenCalled()
  })
  it('/api/action 其他動作不受影響', async () => {
    expect((await action(post('/api/action', { action: 'clear-cache' }))).status).toBe(200)
  })
  it('/api/upgrade/apply → 409，且在檢查安裝型態之前就拒絕', async () => {
    const res = await apply(post('/api/upgrade/apply', { url: 'x' }))
    expect(res.status).toBe(409)
    expect(m.info).not.toHaveBeenCalled()
    expect(m.startJob).not.toHaveBeenCalled()
  })
})
