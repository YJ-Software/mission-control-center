import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/**
 * job runner 的收尾 phase（alwaysRun）與 shell phase 時限。child_process 全部攔下：spawn 回傳假的子行程，
 * 其他呼叫一律記一筆並丟錯；process.kill 也換成 spy，不會對任何真實行程群組送訊號。
 */

const m = vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MISSION_CONTROL_DATA_DIR = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-runner-always-'))
  const unexpected: string[] = []
  const guard = (name: string) => (...args: unknown[]) => {
    unexpected.push(`${name} ${JSON.stringify(args[0])}`)
    throw new Error(`unmocked child_process.${name} in test`)
  }
  return { unexpected, guard, spawn: vi.fn() }
})

vi.mock('child_process', async (orig) => ({
  ...(await orig<typeof import('child_process')>()),
  exec: vi.fn(m.guard('exec')), execSync: vi.fn(m.guard('execSync')), spawn: m.spawn,
  spawnSync: vi.fn(m.guard('spawnSync')), execFile: vi.fn(m.guard('execFile')), execFileSync: vi.fn(m.guard('execFileSync')),
}))
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  exec: vi.fn(m.guard('exec')), execSync: vi.fn(m.guard('execSync')), spawn: m.spawn,
  spawnSync: vi.fn(m.guard('spawnSync')), execFile: vi.fn(m.guard('execFile')), execFileSync: vi.fn(m.guard('execFileSync')),
}))

import { startJob } from '@/lib/jobs/runner'
import { readAllJobsSync } from '@/lib/jobs/store'
import type { JobMeta } from '@/lib/jobs/types'

/** 假子行程：收到 SIGTERM 就以 signal 結束（close code null） */
function fakeChild(pid: number) {
  const child = Object.assign(new EventEmitter(), { pid, stdout: new PassThrough(), stderr: new PassThrough() })
  return child
}

async function settled(id: string): Promise<JobMeta> {
  let job: JobMeta | undefined
  await vi.waitFor(() => {
    job = readAllJobsSync().find(j => j.id === id)
    expect(job && job.status !== 'running').toBe(true)
  }, { timeout: 3000 })
  return job!
}

let killSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  m.unexpected.length = 0
  m.spawn.mockReset().mockImplementation(m.guard('spawn'))
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
})

afterEach(() => {
  killSpy.mockRestore()
  vi.useRealTimers()
  expect(m.unexpected).toEqual([])
})

describe('alwaysRun phases', () => {
  it('a failed phase skips the rest, but an alwaysRun phase still runs and the job stays failed', async () => {
    const ran: string[] = []
    const phase = (name: string, code: number, alwaysRun = false) => ({
      name, alwaysRun, inline: async () => { ran.push(name); return code },
    })
    const meta = startJob({
      kind: 'upgrade-openclaw', label: 'test', triggeredBy: 'api',
      phases: [phase('stop', 0), phase('update', 1), phase('not-run', 0), phase('start', 0, true), phase('note', 0, true)],
    })
    const job = await settled(meta.id)
    expect(ran).toEqual(['stop', 'update', 'start', 'note'])
    expect(job.status).toBe('failed')
    expect(job.phases.map(p => p.status)).toEqual(['success', 'failed', 'skipped', 'success', 'success'])
  })

  it('a failing alwaysRun phase also fails the job', async () => {
    const meta = startJob({
      kind: 'upgrade-openclaw', label: 'test', triggeredBy: 'api',
      phases: [
        { name: 'update', inline: async () => 0 },
        { name: 'start', alwaysRun: true, inline: async () => 5 },
      ],
    })
    const job = await settled(meta.id)
    expect(job.status).toBe('failed')
    expect(job.phases.map(p => p.status)).toEqual(['success', 'failed'])
  })

  it('without alwaysRun the behaviour is unchanged (everything after a failure is skipped)', async () => {
    const meta = startJob({
      kind: 'restart-openclaw', label: 'test', triggeredBy: 'api',
      phases: [{ name: 'a', inline: async () => 2 }, { name: 'b', inline: async () => 0 }],
    })
    const job = await settled(meta.id)
    expect(job.phases.map(p => p.status)).toEqual(['failed', 'skipped'])
  })
})

describe('shell phase timeoutMs', () => {
  it('kills the whole process group on timeout, exits 124, and the alwaysRun phase still runs', async () => {
    const child = fakeChild(424242)
    m.spawn.mockImplementation(() => child)
    killSpy.mockImplementation(((pid: number, signal?: string) => {
      if (pid === -424242 && signal === 'SIGTERM') setTimeout(() => child.emit('close', null), 5)
      return true
    }) as typeof process.kill)
    let started = false
    const meta = startJob({
      kind: 'upgrade-openclaw', label: 'test', triggeredBy: 'api',
      phases: [
        { name: 'update', shell: 'openclaw update --yes 2>&1', timeoutMs: 50 },
        { name: 'start', alwaysRun: true, inline: async () => { started = true; return 0 } },
      ],
    })
    const job = await settled(meta.id)
    expect(m.spawn).toHaveBeenCalledWith('bash', ['-c', 'openclaw update --yes 2>&1'], expect.objectContaining({ detached: true }))
    expect(killSpy).toHaveBeenCalledWith(-424242, 'SIGTERM')
    expect(job.phases[0]).toMatchObject({ status: 'failed', exitCode: 124 })
    expect(started).toBe(true)
  })

  it('M4: a child that never closes its pipe after SIGKILL still ends the phase with 124 ~15 s later, and the cleanup phase runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = fakeChild(454545)
    m.spawn.mockImplementation(() => child) // 永遠不送 close：模擬脫離行程群組又握著 stdout 的子孫
    let started = false
    const meta = startJob({
      kind: 'upgrade-openclaw', label: 'test', triggeredBy: 'api',
      phases: [
        { name: 'update', shell: 'openclaw update --yes --no-restart 2>&1', timeoutMs: 1000 },
        { name: 'start', alwaysRun: true, inline: async () => { started = true; return 0 } },
      ],
    })
    const status = () => readAllJobsSync().find(j => j.id === meta.id)
    await vi.advanceTimersByTimeAsync(1000 + 10_000)
    expect(killSpy).toHaveBeenCalledWith(-454545, 'SIGTERM')
    expect(killSpy).toHaveBeenCalledWith(-454545, 'SIGKILL')
    expect(status()?.status).toBe('running')
    expect(started).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    for (let i = 0; i < 20 && status()?.status === 'running'; i++) await Promise.resolve()
    const job = status()!
    expect(job.phases[0]).toMatchObject({ status: 'failed', exitCode: 124 })
    expect(started).toBe(true)
    // 晚到的 close 不會再改結果
    child.emit('close', 0)
    expect(readAllJobsSync().find(j => j.id === meta.id)!.phases[0].exitCode).toBe(124)
  })

  it('phases without a timeout are not detached and never signalled', async () => {
    const child = fakeChild(434343)
    m.spawn.mockImplementation(() => { setTimeout(() => child.emit('close', 0), 5); return child })
    const meta = startJob({ kind: 'restart-openclaw', label: 'test', triggeredBy: 'api', phases: [{ name: 'x', shell: 'true' }] })
    const job = await settled(meta.id)
    expect(job.status).toBe('success')
    expect(m.spawn.mock.calls[0][2]).toMatchObject({ detached: false })
    expect(killSpy).not.toHaveBeenCalled()
  })
})
