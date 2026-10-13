import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * MCC 的 unit 是 KillMode=control-group：MCC 自己發起的重啟（重啟儀表板、升級、重開機、release 還原）
 * 會連同 cgroup 內的 sudo apt-get / dpkg 一起殺掉。長時間安裝作業登記表非空時，這些路徑一律 409，
 * JSON 帶正在跑的作業名稱與開始時間。
 */

const m = vi.hoisted(() => ({ busy: vi.fn(), startJob: vi.fn(), info: vi.fn(), restart: vi.fn(), exec: vi.fn() }))
// restart-dashboard／reboot 的 phase 會 exec systemctl：一律攔下，絕不能在測試機上真的重啟或重開機
vi.mock('child_process', async (orig) => ({ ...(await orig<typeof import('child_process')>()), exec: m.exec }))
vi.mock('@/lib/backup/lock', () => ({ isBackupOrRestoreBusy: m.busy }))
vi.mock('@/lib/jobs/runner', () => ({ startJob: m.startJob }))
vi.mock('@/lib/upgrade/manager', () => ({
  getInstallInfo: m.info, applyUpgrade: vi.fn(), cleanupTempTarball: vi.fn(),
  downloadArtifact: vi.fn(), scheduleServiceRestart: m.restart,
}))

import { POST as action } from '@/app/api/action/route'
import { POST as apply } from '@/app/api/upgrade/apply/route'
import { registerLongRun, unregisterLongRun, _resetLongRunsForTest, markRestartPending, isRestartPending } from '@/lib/long-running'

const post = (url: string, body: unknown) =>
  new NextRequest(`http://mcc.local${url}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  _resetLongRunsForTest(() => true) // 測試裡的假 PID 都視為活著
  m.busy.mockReset().mockReturnValue(false)
  m.startJob.mockReset().mockReturnValue({ id: 'j' })
  m.info.mockReset().mockReturnValue({ mode: 'release', service: 's' })
  m.restart.mockReset()
  m.exec.mockReset()
})

const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://mcc.local${url}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })

async function expectBusy(res: Response, name: string) {
  expect(res.status).toBe(409)
  const body = await res.json()
  expect(body.code).toBe('long-run-busy')
  expect(body.success).toBe(false)
  expect(body.error).toContain(name)
  expect(body.longRuns).toEqual([expect.objectContaining({ name, startedAt: expect.any(String) })])
  expect(body.longRuns[0]).toHaveProperty('pid') // 有 PID 時是數字，沒有時 null（前端顯示「無 PID」）
  expect(new Date(body.longRuns[0].startedAt).getTime()).toBeGreaterThan(0)
}

describe('長時間安裝作業進行中拒絕 MCC 自己的重啟', () => {
  for (const a of ['restart-dashboard', 'update-mcc', 'reboot-system']) {
    it(`/api/action ${a} → 409（含作業名稱、開始時間、PID），不啟動 job`, async () => {
      registerLongRun('ImunifyAV 安裝', { pid: 4242 })
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
    for (const a of ['restart-openclaw', 'sys-update', 'clear-cache']) {
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
      // 等待是獨立 phase（最後一個 phase 之前），等待期間 job 仍是 running
      expect(spec.phases.map((p: { name: string }) => p.name)).toEqual(['等待安裝作業結束', 'schedule restart (mission-control)'])
      const phase = spec.phases[0]
      const logs: string[] = []
      const id = registerLongRun('npm -g opencli')
      const p = phase.inline((_s: string, t: string) => logs.push(t), {})
      await vi.advanceTimersByTimeAsync(10_000)
      expect(logs.some((l) => l.includes('等待長時間作業完成後再重啟'))).toBe(true)
      let finished = false
      void p.then(() => { finished = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(finished).toBe(false)
      unregisterLongRun(id)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await p).toBe(0)
      expect(logs.at(-1)).toContain('長時間作業已結束')
    } finally {
      vi.useRealTimers()
    }
  })

  it('force: true → 放行並在伺服器 log 記下被略過的清單；等待 phase 不等、job log 記同一行', async () => {
    registerLongRun('ImunifyAV 安裝', { pid: 4242 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const a of ['restart-dashboard', 'reboot-system']) {
      m.startJob.mockClear()
      const res = await action(post('/api/action', { action: a, force: true }))
      expect(res.status).toBe(200)
      const spec = m.startJob.mock.calls[0][0]
      expect(spec.phases[0].name).toBe('等待安裝作業結束')
      const logs: string[] = []
      expect(await spec.phases[0].inline((_s: string, t: string) => logs.push(t), {})).toBe(0)
      expect(logs).toEqual([expect.stringMatching(/^使用者強制重啟，略過進行中：「ImunifyAV 安裝」（.*PID 4242）$/)])
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[restart] 使用者強制重啟，略過進行中：「ImunifyAV 安裝」'))
    warn.mockRestore()
  })

  it('force 只接受明確的 true；其他值仍 409', async () => {
    registerLongRun('ImunifyAV 安裝', { pid: 4242 })
    for (const force of [false, 'yes', 1, null]) {
      expect((await action(post('/api/action', { action: 'restart-dashboard', force }))).status).toBe(409)
    }
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('/api/upgrade/apply：JSON body 的 force 或上傳模式的 x-force-restart header 都能略過', async () => {
    registerLongRun('Neo4j 圖資料庫安裝', { pid: 7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await apply(postJson('/api/upgrade/apply', { url: 'x' }))).status).toBe(409)
    const r1 = await apply(postJson('/api/upgrade/apply', { url: 'x', force: true }))
    expect(r1.status).toBe(200)
    const spec = m.startJob.mock.calls[0][0]
    expect(spec.phases.map((p: { name: string }) => p.name).slice(-2)).toEqual(['等待安裝作業結束', 'restart service (s)'])
    const upload = (headers: Record<string, string>) => new NextRequest('http://mcc.local/api/upgrade/apply', {
      method: 'POST', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'application/octet-stream', ...headers },
    })
    expect((await apply(upload({}))).status).toBe(409)
    expect((await apply(upload({ 'x-force-restart': '1' }))).status).toBe(200)
    warn.mockRestore()
  })

  it('重啟 phase 排程重啟時設定「即將重啟」，之後的新安裝會被拒絕', async () => {
    // 安全閥：確認 exec 真的被 mock 掉，否則這個測試會在本機真的重啟 mission-control
    const cp = await import('child_process')
    expect(cp.exec).toBe(m.exec)
    await action(post('/api/action', { action: 'restart-dashboard' }))
    const spec = m.startJob.mock.calls[0][0]
    vi.useFakeTimers()
    try {
      expect(await spec.phases[1].inline(() => {}, {})).toBe(0)
      expect(isRestartPending()).toBe(true)
      await vi.advanceTimersByTimeAsync(3000)
      expect(m.exec).toHaveBeenCalledWith(expect.stringContaining('systemctl'), expect.any(Function)) // 被攔下的 mock
      // 重啟指令失敗（成功時本行程會被殺掉，不會走到 callback）→ 立刻解除「即將重啟」
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const cb = m.exec.mock.calls[0][1] as (e: (Error & { signal?: string }) | null) => void
      // 重啟成功時 systemctl 會跟著 cgroup 被 SIGTERM：那是「重啟進行中」，不記 failed、不解除旗標
      cb(Object.assign(new Error('Command failed: systemctl restart …'), { signal: 'SIGTERM' }))
      expect(isRestartPending()).toBe(true)
      expect(warn).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('重啟已排程'))
      // 真的以非 0 結束才是失敗
      cb(new Error('Failed to restart'))
      expect(isRestartPending()).toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('restart-dashboard failed'))
      warn.mockRestore(); log.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('即將重啟時，sys-update 等 apt 類動作回 409（startJob 丟 RestartPendingError）', async () => {
    const { RestartPendingError } = await import('@/lib/long-running')
    m.startJob.mockImplementation(() => { throw new RestartPendingError() })
    const res = await action(post('/api/action', { action: 'sys-update' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('restart-pending')
    expect(body.error).toContain('MCC 即將重啟')
    markRestartPending(0)
  })

  it('重開機指令失敗（sudo 不放行、systemctl 非 0）時立刻解除「即將重啟」；成功前維持', async () => {
    const cp = await import('child_process')
    expect(cp.exec).toBe(m.exec) // 安全閥：沒攔到就不能往下跑（會真的重開機）
    await action(post('/api/action', { action: 'reboot-system' }))
    const spec = m.startJob.mock.calls[0][0]
    expect(await spec.phases[1].inline(() => {}, {})).toBe(0)
    expect(m.exec).toHaveBeenCalledWith('sh -c "sleep 3; sudo -n systemctl reboot"', expect.any(Function))
    expect(isRestartPending()).toBe(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cb = m.exec.mock.calls[0][1] as (e: (Error & { signal?: string }) | null) => void
    cb(Object.assign(new Error('killed'), { signal: 'SIGTERM' })) // 關機流程在殺行程：不是失敗
    expect(isRestartPending()).toBe(true)
    cb(new Error('sudo: a password is required'))
    expect(isRestartPending()).toBe(false)
    warn.mockRestore()
  })

  it('dpkg-repair：其他安裝作業進行中回 409（第二個 dpkg 只會撞鎖）', async () => {
    registerLongRun('apt update + upgrade', { pid: 9 })
    const res = await action(post('/api/action', { action: 'dpkg-repair' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('long-run-busy')
    expect(body.error).toContain('撞上套件管理員的鎖')
    expect(m.startJob).not.toHaveBeenCalled()
  })

  it('dpkg-repair 動作開 dpkg-repair job，失敗就是失敗（不帶 || echo）', async () => {
    await action(post('/api/action', { action: 'dpkg-repair' }))
    const spec = m.startJob.mock.calls[0][0]
    expect(spec.kind).toBe('dpkg-repair')
    expect(spec.phases[0].shell).toMatch(/^sudo -n env .*dpkg --force-confdef --force-confold --configure -a 2>&1$/)
  })
})
