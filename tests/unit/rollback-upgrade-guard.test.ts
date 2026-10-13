import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * rollbackUpgrade 會 `ln -sfn` 真的安裝 prefix 並 spawn `systemctl --user restart`。這個檔案把
 * child_process（兩種寫法）與 fs 的 symlink 類操作全部攔下、MC_PREFIX 指到暫存目錄，
 * 每個測試先斷言攔截生效才呼叫——攔不到就在動任何東西之前失敗。
 */

const m = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MC_PREFIX = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-rollback-prefix-'))
  const child = { on: vi.fn(), unref: vi.fn() }
  return {
    child,
    execFile: vi.fn((...a: unknown[]) => {
      const cb = a[a.length - 1]
      if (typeof cb === 'function') (cb as (e: null, o: string, s: string) => void)(null, '', '')
      return { on: vi.fn() }
    }),
    spawn: vi.fn(() => child),
    exec: vi.fn(),
    symlinkSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

vi.mock('node:child_process', async (orig) => {
  const a = await orig<typeof import('node:child_process')>()
  const over = { execFile: m.execFile, spawn: m.spawn, exec: m.exec }
  return { ...a, ...over, default: { ...a, ...over } }
})
vi.mock('child_process', async (orig) => {
  const a = await orig<typeof import('child_process')>()
  const over = { execFile: m.execFile, spawn: m.spawn, exec: m.exec }
  return { ...a, ...over, default: { ...a, ...over } }
})
vi.mock('node:fs', async (orig) => {
  const a = await orig<typeof import('node:fs')>()
  const over = { symlinkSync: m.symlinkSync, unlinkSync: m.unlinkSync, rmSync: m.rmSync }
  return { ...a, ...over, default: { ...a, ...over } }
})

import path from 'node:path'
import { rollbackUpgrade } from '@/lib/upgrade/manager'
import { LongRunBusyError, registerLongRun, isRestartPending, _resetLongRunsForTest } from '@/lib/long-running'

async function assertIntercepted() {
  const cp = await import('node:child_process')
  const cp2 = await import('child_process')
  const fs = await import('node:fs')
  expect(cp.execFile).toBe(m.execFile)
  expect(cp.spawn).toBe(m.spawn)
  expect(cp2.spawn).toBe(m.spawn)
  expect(fs.symlinkSync).toBe(m.symlinkSync)
  expect(process.env.MC_PREFIX).toMatch(/mcc-rollback-prefix-/)
}

beforeEach(() => {
  _resetLongRunsForTest(() => true)
  for (const f of [m.execFile, m.spawn, m.exec, m.symlinkSync, m.unlinkSync, m.rmSync, m.child.on]) f.mockClear()
})

describe('rollbackUpgrade 的長時間作業互鎖', () => {
  it('進行中且沒帶 force：丟 LongRunBusyError，不 ln、不 spawn', async () => {
    await assertIntercepted()
    registerLongRun('apt update + upgrade', { pid: 7 })
    await expect(rollbackUpgrade('/prev', 'svc')).rejects.toBeInstanceOf(LongRunBusyError)
    expect(m.execFile).not.toHaveBeenCalled()
    expect(m.spawn).not.toHaveBeenCalled()
  })

  it('force：放行並記「使用者強制重啟，略過進行中：…」；ln 與 restart 都打到 mock（暫存 prefix）', async () => {
    await assertIntercepted()
    registerLongRun('apt update + upgrade', { pid: 7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await rollbackUpgrade('/prev', 'svc', { force: true })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[restart\] 使用者強制重啟，略過進行中：「apt update \+ upgrade」（.*PID 7）$/))
    expect(m.execFile).toHaveBeenCalledWith('ln', ['-sfn', '/prev', path.join(process.env.MC_PREFIX!, 'current')], expect.any(Function))
    expect(m.spawn).toHaveBeenCalledWith('bash', ['-c', 'sleep 2 && systemctl --user restart svc'], expect.anything())
    expect(isRestartPending()).toBe(true)
    warn.mockRestore()
  })

  it('排程的 systemctl restart 失敗（exit 非 0）時立刻解除「即將重啟」', async () => {
    await assertIntercepted()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await rollbackUpgrade('/prev', 'svc')
    expect(isRestartPending()).toBe(true)
    const onExit = m.child.on.mock.calls.find((c) => c[0] === 'exit')![1] as (code: number | null) => void
    onExit(null) // 被訊號終止：重啟正在殺 cgroup，不是失敗
    expect(isRestartPending()).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    onExit(1)
    expect(isRestartPending()).toBe(false)
    warn.mockRestore()
  })
})
