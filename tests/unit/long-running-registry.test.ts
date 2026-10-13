import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MISSION_CONTROL_DATA_DIR = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-longrun-data-'))
  return {}
})
void h

import {
  registerLongRun, unregisterLongRun, updateLongRun, listLongRuns, hasLongRuns, withLongRun, withLongRunSync,
  assertNoLongRuns, LongRunBusyError, longRunBusyBody, waitForNoLongRuns, LONG_RUNNING_JOB_KINDS, _resetLongRunsForTest,
  markRestartPending, clearRestartPending, isRestartPending, RestartPendingError, pruneDeadLongRuns, forcedRestartNote,
} from '@/lib/long-running'
import { readAllJobsSync } from '@/lib/jobs/store'
import { buildSpawnArgs } from '@/lib/headless-vnc/sse-stream'
import { createSSEStream, withAptSelfHeal } from '@/lib/headless-vnc/sse-stream'
import { startJob } from '@/lib/jobs/runner'
import { parseLongRunBusy } from '@/lib/long-run-client'

beforeEach(() => _resetLongRunsForTest())

describe('長時間作業登記表', () => {
  it('登記、更新 PID／步驟、註銷', () => {
    expect(hasLongRuns()).toBe(false)
    const id = registerLongRun('Obsidian 安裝')
    updateLongRun(id, { pid: process.pid, step: 'Installing Obsidian' })
    const [e] = listLongRuns()
    expect(e).toMatchObject({ id, name: 'Obsidian 安裝', pid: process.pid, step: 'Installing Obsidian' })
    expect(new Date(e.startedAt).getTime()).toBeGreaterThan(0)
    expect(unregisterLongRun(id)).toBe(true)
    expect(unregisterLongRun(id)).toBe(false) // 重複註銷無害
    expect(hasLongRuns()).toBe(false)
  })

  it('listLongRuns 回傳複本，改了不影響登記表', () => {
    registerLongRun('a')
    listLongRuns()[0].name = 'x'
    expect(listLongRuns()[0].name).toBe('a')
  })

  it('跨模組實例共用（放在 globalThis）', () => {
    registerLongRun('a')
    const store = (globalThis as Record<string, unknown>).__mccLongRuns as Map<number, unknown>
    expect(store.size).toBe(1)
  })

  it('withLongRun 丟錯時也會註銷', async () => {
    await expect(withLongRun('boom', async () => {
      expect(hasLongRuns()).toBe(true)
      throw new Error('x')
    })).rejects.toThrow('x')
    expect(hasLongRuns()).toBe(false)
    expect(() => withLongRunSync('sync', () => { throw new Error('y') })).toThrow('y')
    expect(hasLongRuns()).toBe(false)
  })

  it('assertNoLongRuns 丟出含名稱與開始時間的 LongRunBusyError', () => {
    expect(() => assertNoLongRuns()).not.toThrow()
    registerLongRun('ImunifyAV 安裝')
    let err: unknown
    try { assertNoLongRuns() } catch (e) { err = e }
    expect(err).toBeInstanceOf(LongRunBusyError)
    expect((err as Error).message).toContain('「ImunifyAV 安裝」')
    expect((err as Error).message).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} 開始/)
  })

  it('409 本體帶 code、可直接顯示的 error 與 longRuns 清單', () => {
    _resetLongRunsForTest(() => true) // PID 99 視為活著
    const id = registerLongRun('apt update + upgrade')
    updateLongRun(id, { pid: 99, step: 'apt-get upgrade' })
    const body = longRunBusyBody()
    expect(body.success).toBe(false)
    expect(body.code).toBe('long-run-busy')
    expect(body.error).toContain('apt update + upgrade')
    expect(body.longRuns).toEqual([{ name: 'apt update + upgrade', startedAt: expect.any(String), pid: 99, step: 'apt-get upgrade' }])
    // 前端解析
    const parsed = parseLongRunBusy(JSON.parse(JSON.stringify(body)))
    expect(parsed?.[0].name).toBe('apt update + upgrade')
    expect(parsed?.[0]).toMatchObject({ pid: 99, step: 'apt-get upgrade' })
    expect(parseLongRunBusy({ error: '備份或還原進行中' })).toBeNull()
  })

  it('waitForNoLongRuns：清空後回 true；逾時回 false 並留下紀錄', async () => {
    expect(await waitForNoLongRuns()).toBe(true)
    const id = registerLongRun('npm -g')
    setTimeout(() => unregisterLongRun(id), 30)
    const logs: string[] = []
    expect(await waitForNoLongRuns((m) => logs.push(m), { pollMs: 5, maxWaitMs: 2000 })).toBe(true)
    expect(logs[0]).toContain('npm -g')
    registerLongRun('stuck')
    const logs2: string[] = []
    expect(await waitForNoLongRuns((m) => logs2.push(m), { pollMs: 5, maxWaitMs: 20 })).toBe(false)
    expect(logs2.at(-1)).toContain('照常重啟')
  })
})

describe('PID 存活檢查', () => {
  it('子行程已不存在的登記項：檢查時當場註銷並記 log', () => {
    const alive = new Set([111])
    _resetLongRunsForTest((pid) => alive.has(pid))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = registerLongRun('還在跑', { pid: 111 })
    registerLongRun('已經死了', { pid: 222 })
    registerLongRun('沒有 PID') // 兩步之間：無從判斷，保留
    expect(listLongRuns().map((r) => r.name)).toEqual(['還在跑', '沒有 PID'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('「已經死了」的 PID 222 已不存在，自動註銷'))
    alive.delete(111)
    expect(pruneDeadLongRuns().map((r) => r.id)).toEqual([a])
    expect(hasLongRuns()).toBe(true) // 沒有 PID 的那筆
    warn.mockRestore()
  })

  it('預設檢查：EPERM（root 擁有的 sudo）視為活著，ESRCH 才註銷', () => {
    _resetLongRunsForTest()
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      const e = Object.assign(new Error('x'), { code: pid === 1 ? 'EPERM' : 'ESRCH' })
      throw e
    }) as typeof process.kill)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerLongRun('root sudo', { pid: 1 })
    registerLongRun('gone', { pid: 999999 })
    expect(listLongRuns().map((r) => r.name)).toEqual(['root sudo'])
    kill.mockRestore(); warn.mockRestore()
  })

  it('描述與強制紀錄都帶 PID；沒有 PID 註記「無 PID」', () => {
    _resetLongRunsForTest(() => true)
    registerLongRun('A', { pid: 42 })
    registerLongRun('B')
    const note = forcedRestartNote(listLongRuns())
    expect(note).toMatch(/^使用者強制重啟，略過進行中：「A」（.* 開始，PID 42）、「B」（.* 開始，無 PID）$/)
  })
})

describe('MCC 即將重啟', () => {
  it('重啟排程後拒絕新的登記；ttl 過了或清除後恢復', async () => {
    markRestartPending(50)
    expect(isRestartPending()).toBe(true)
    expect(() => registerLongRun('x')).toThrow(RestartPendingError)
    await new Promise((r) => setTimeout(r, 70))
    expect(isRestartPending()).toBe(false)
    expect(() => registerLongRun('x')).not.toThrow()
    markRestartPending()
    clearRestartPending()
    expect(isRestartPending()).toBe(false)
  })

  it('SSE 安裝串流：回 error 事件，不執行任何指令', async () => {
    markRestartPending()
    const r = createSSEStream([{ label: 'x', cmd: 'sh', args: ['-c', 'echo SHOULD-NOT-RUN'] }], { name: 'x' }).getReader()
    let out = ''
    for (;;) { const { done, value } = await r.read(); if (done) break; out += new TextDecoder().decode(value) }
    expect(out).toContain('"type":"error"')
    expect(out).toContain('MCC 即將重啟')
    expect(out).not.toContain('SHOULD-NOT-RUN')
    expect(hasLongRuns()).toBe(false)
  })

  it('job runner：apt 類 job 直接丟錯，不留下永遠 running 的 job 紀錄', () => {
    markRestartPending()
    const before = readAllJobsSync().length
    expect(() => startJob({ kind: 'sys-update', label: 'apt', triggeredBy: 'api', phases: [{ name: 'x', shell: 'true' }] }))
      .toThrow(RestartPendingError)
    expect(readAllJobsSync().length).toBe(before)
  })
})

describe('SSE 實際 spawn 的參數', () => {
  it('sudo apt：保留 sudo 旗標在 env 之前，帶非互動環境、-y 與 conffile 選項', () => {
    expect(buildSpawnArgs('sudo', ['-n', 'dpkg', '--force-confdef', '--force-confold', '--configure', '-a'])).toEqual([
      '-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'NEEDRESTART_MODE=a', 'NEEDRESTART_SUSPEND=1',
      'UCF_FORCE_CONFFOLD=1', 'APT_LISTCHANGES_FRONTEND=none', 'dpkg', '--force-confdef', '--force-confold', '--configure', '-a',
    ])
    const apt = buildSpawnArgs('sudo', ['apt', 'install', '-y', 'couchdb'])
    expect(apt.slice(0, 2)).toEqual(['env', 'DEBIAN_FRONTEND=noninteractive'])
    expect(apt.slice(6)).toEqual(['apt', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold', 'install', '-y', 'couchdb'])
  })
  it('非 sudo、非 apt 的指令原樣', () => {
    expect(buildSpawnArgs('npm', ['install', '-g', 'x'])).toEqual(['install', '-g', 'x'])
    expect(buildSpawnArgs('bash', ['-c', 'yes | sudo env X=1 bash s.sh'])).toEqual(['-c', 'yes | sudo env X=1 bash s.sh'])
  })
})

describe('SSE 安裝串流', () => {
  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    const r = stream.getReader()
    const dec = new TextDecoder()
    let out = ''
    for (;;) {
      const { done, value } = await r.read()
      if (done) return out
      out += dec.decode(value)
    }
  }

  it('整段串流期間都登記（含 PID 與目前步驟），結束後註銷', async () => {
    let seen: ReturnType<typeof listLongRuns> = []
    const stream = createSSEStream(
      [{ label: 'step one', cmd: 'sh', args: ['-c', 'sleep 0.2'] }],
      {
        name: '測試安裝',
        onAfter: () => { seen = listLongRuns() },
      },
    )
    const p = drain(stream)
    await new Promise((r) => setTimeout(r, 100))
    const mid = listLongRuns()
    expect(mid).toHaveLength(1)
    expect(mid[0]).toMatchObject({ name: '測試安裝', step: 'step one' })
    expect(mid[0].pid).toBeGreaterThan(0)
    const out = await p
    expect(out).toContain('"type":"done"')
    expect(seen).toHaveLength(1) // onAfter 時仍在登記中
    expect(hasLongRuns()).toBe(false)
  })

  it('子行程 exit 但 close 未觸發（孫行程握著 stdout）：PID 已清成 null，死 PID 清理不會刪掉登記項，下一步仍在登記中', async () => {
    _resetLongRunsForTest() // 真的 PID 存活檢查
    let duringStep2: ReturnType<typeof listLongRuns> = []
    const stream = createSSEStream([
      // sh 立刻 exit，背景的 sleep 繼續握著 stdout，close 延後約 0.6 秒
      { label: 'step one', cmd: 'sh', args: ['-c', '(sleep 0.6) & exit 0'] },
      { label: 'step two', cmd: 'sh', args: ['-c', 'sleep 0.1'] },
    ], { name: '孫行程測試', onAfter: () => { duringStep2 = listLongRuns() } })
    const p = drain(stream)
    await new Promise((r) => setTimeout(r, 250))
    // exit 已觸發、close 還沒：登記項仍在，PID 為 null
    expect(pruneDeadLongRuns()).toEqual([])
    const mid = listLongRuns()
    expect(mid).toHaveLength(1)
    expect(mid[0]).toMatchObject({ name: '孫行程測試', step: 'step one', pid: null })
    await p
    expect(duringStep2).toHaveLength(1) // 走完第二步、onAfter 時仍在登記中
    expect(hasLongRuns()).toBe(false)
  })

  it('步驟失敗時也會註銷', async () => {
    const out = await drain(createSSEStream([{ label: 'fail', cmd: 'sh', args: ['-c', 'exit 3'] }], { name: 'x' }))
    expect(out).toContain('"type":"error"')
    expect(hasLongRuns()).toBe(false)
  })

  it('第一個 apt 步驟前插入一次 dpkg --configure -a（optional）', () => {
    const cmds = withAptSelfHeal([
      { label: 'curl', cmd: 'curl', args: ['-o', '/tmp/x'] },
      { label: 'apt', cmd: 'sudo', args: ['apt-get', 'install', '-y', 'xvfb'] },
      { label: 'apt2', cmd: 'sudo', args: ['apt-get', 'install', '-y', 'fcitx5'] },
    ])
    expect(cmds.map((c) => c.label)).toEqual(['curl', expect.stringContaining('dpkg --configure -a'), 'apt', 'apt2'])
    expect(cmds[1]).toMatchObject({ cmd: 'sudo', args: ['-n', 'dpkg', '--force-confdef', '--force-confold', '--configure', '-a'], optional: true })
  })

  it('沒有 apt 就不插；已經有修復步驟也不重複插；force 時插在最前面', () => {
    const plain = [{ label: 'npm', cmd: 'npm', args: ['install', '-g', 'x'] }]
    expect(withAptSelfHeal(plain)).toBe(plain)
    const forced = withAptSelfHeal(plain, true)
    expect(forced[0].args).toEqual(['-n', 'dpkg', '--force-confdef', '--force-confold', '--configure', '-a'])
    expect(withAptSelfHeal(forced, true)).toBe(forced)
  })
})

describe('job runner', () => {
  it('apt/npm 類 job 整段登記為長時間作業', () => {
    for (const k of ['sys-update', 'dpkg-repair', 'upgrade-openclaw', 'upgrade-opencli', 'upgrade-nlm'] as const) {
      expect(LONG_RUNNING_JOB_KINDS.has(k)).toBe(true)
    }
    expect(LONG_RUNNING_JOB_KINDS.has('restart-mcc')).toBe(false)
  })

  it('runner：shell phase 的子行程 exit 但 close 未觸發時，登記項仍在、PID 為 null', async () => {
    _resetLongRunsForTest()
    let settled!: () => void
    const done = new Promise<void>((r) => { settled = r })
    startJob({
      kind: 'sys-update', label: 'apt（孫行程）', triggeredBy: 'api',
      phases: [{ name: 'fake', shell: '(sleep 0.6) & exit 0' }],
      onSettled: () => settled(),
    })
    await new Promise((r) => setTimeout(r, 250))
    expect(pruneDeadLongRuns()).toEqual([])
    expect(listLongRuns()).toEqual([expect.objectContaining({ name: 'apt（孫行程）', pid: null, kind: 'sys-update' })])
    await done
    expect(hasLongRuns()).toBe(false)
  })

  it('sys-update 執行中登記（shell phase 帶 PID），結束後註銷；restart-mcc 不登記', async () => {
    let settled!: () => void
    const done = new Promise<void>((r) => { settled = r })
    startJob({
      kind: 'sys-update', label: 'apt update + upgrade', triggeredBy: 'api',
      phases: [{ name: 'fake apt', shell: 'sleep 0.3' }],
      onSettled: () => settled(),
    })
    await new Promise((r) => setTimeout(r, 120))
    const mid = listLongRuns()
    expect(mid).toHaveLength(1)
    expect(mid[0]).toMatchObject({ name: 'apt update + upgrade', step: 'fake apt' })
    expect(mid[0].pid).toBeGreaterThan(0)
    await done
    expect(hasLongRuns()).toBe(false)

    let settled2!: () => void
    const done2 = new Promise<void>((r) => { settled2 = r })
    startJob({
      kind: 'restart-mcc', label: 'Restart', triggeredBy: 'api',
      phases: [{ name: 'noop', inline: async () => { expect(hasLongRuns()).toBe(false); return 0 } }],
      onSettled: () => settled2(),
    })
    await done2
  })
})
