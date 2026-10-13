import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * MCC 的 unit 是 KillMode=control-group：MCC 自己發起的重啟（重啟儀表板、升級、重開機、release 還原）
 * 會連同 cgroup 內的 sudo apt-get / dpkg 一起殺掉。長時間安裝作業登記表非空時，這些路徑一律 409，
 * JSON 帶正在跑的作業名稱與開始時間。
 */

const m = vi.hoisted(() => ({ busy: vi.fn(), startJob: vi.fn(), info: vi.fn(), restart: vi.fn() }))
vi.mock('@/lib/backup/lock', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/jobs/runner', () => ({ startJob: m.startJob }))
vi.mock('@/lib/upgrade/manager', () => ({
  getInstallInfo: m.info, applyUpgrade: vi.fn(), cleanupTempTarball: vi.fn(),
  downloadArtifact: vi.fn(), scheduleServiceRestart: m.restart,
}))

import { POST as action } from '@/app/api/action/route'
import { POST as apply } from '@/app/api/upgrade/apply/route'
import { registerLongRun, unregisterLongRun, _resetLongRunsForTest } from '@/lib/long-running'

const post = (url: string, body: unknown) =>
  new NextRequest(`http://mcc.local${url}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  _resetLongRunsForTest()
  m.busy.mockReset().mockReturnValue(false)
  m.startJob.mockReset().mockReturnValue({ id: 'j' })
  m.info.mockReset().mockReturnValue({ mode: 'release', service: 's' })
  m.restart.mockReset()
})

async function expectBusy(res: Response, name: string) {
  expect(res.status).toBe(409)
  const body = await res.json()
  expect(body.code).toBe('long-run-busy')
  expect(body.success).toBe(false)
  expect(body.error).toContain(name)
  expect(body.longRuns).toEqual([expect.objectContaining({ name, startedAt: expect.any(String) })])
  expect(new Date(body.longRuns[0].startedAt).getTime()).toBeGreaterThan(0)
}

describe('長時間安裝作業進行中拒絕 MCC 自己的重啟', () => {
  for (const a of ['restart-dashboard', 'update-mcc', 'reboot-system']) {
    it(`/api/action ${a} → 409（含作業名稱與開始時間），不啟動 job`, async () => {
      registerLongRun('ImunifyAV 安裝')
      await expectBusy(await action(post('/api/action', { action: a })), 'ImunifyAV 安裝')
      expect(m.startJob).not.toHaveBeenCalled()
    })
  }

  it('作業結束後同一動作照常放行', async () => {
    const id = registerLongRun('apt update + upgrade')
    expect((await action(post('/api/action', { action: 'restart-dashboard' }))).status).toBe(409)
    unregisterLongRun(id)
    expect((await action(post('/api/action', { action: 'restart-dashboard' }))).status).toBe(200)
    expect(m.startJob).toHaveBeenCalledTimes(1)
  })

  it('不重啟 MCC 的動作不受影響（restart-openclaw、sys-update、dpkg-repair）', async () => {
    registerLongRun('Obsidian 安裝')
    for (const a of ['restart-openclaw', 'sys-update', 'dpkg-repair', 'clear-cache']) {
      expect((await action(post('/api/action', { action: a }))).status).toBe(200)
    }
  })

  it('備份／還原進行中的訊息仍優先（既有互鎖不變）', async () => {
    m.busy.mockReturnValue(true)
    registerLongRun('Obsidian 安裝')
    const res = await action(post('/api/action', { action: 'restart-dashboard' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('備份或還原進行中')
  })

  it('/api/upgrade/apply → 409，在檢查安裝型態、讀取上傳內容之前就拒絕', async () => {
    registerLongRun('Neo4j 圖資料庫安裝')
    await expectBusy(await apply(post('/api/upgrade/apply', { url: 'x' })), 'Neo4j 圖資料庫安裝')
    expect(m.info).not.toHaveBeenCalled()
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('restart-dashboard 的重啟 phase 先等入口之後才開始的作業結束', async () => {
    vi.useFakeTimers()
    try {
      await action(post('/api/action', { action: 'restart-dashboard' }))
      const spec = m.startJob.mock.calls[0][0]
      const phase = spec.phases.at(-1)
      const logs: string[] = []
      const id = registerLongRun('npm -g opencli')
      const p = phase.inline((_s: string, t: string) => logs.push(t), {})
      await vi.advanceTimersByTimeAsync(10_000)
      expect(logs.some((l) => l.includes('等待長時間作業完成後再重啟'))).toBe(true)
      expect(logs.some((l) => l.includes('scheduling restart'))).toBe(false)
      unregisterLongRun(id)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await p).toBe(0)
      expect(logs.some((l) => l.includes('scheduling restart'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dpkg-repair 動作開 dpkg-repair job，失敗就是失敗（不帶 || echo）', async () => {
    await action(post('/api/action', { action: 'dpkg-repair' }))
    const spec = m.startJob.mock.calls[0][0]
    expect(spec.kind).toBe('dpkg-repair')
    expect(spec.phases[0].shell).toMatch(/^sudo -n env .*dpkg --configure -a 2>&1$/)
  })
})

describe('rollbackUpgrade', () => {
  it('長時間作業進行中丟 LongRunBusyError，在動 symlink 之前', async () => {
    const actual = await vi.importActual<typeof import('@/lib/upgrade/manager')>('@/lib/upgrade/manager')
    const { LongRunBusyError } = await import('@/lib/long-running')
    registerLongRun('apt update + upgrade')
    await expect(actual.rollbackUpgrade('/nonexistent/prev', 'svc')).rejects.toBeInstanceOf(LongRunBusyError)
  })
})
