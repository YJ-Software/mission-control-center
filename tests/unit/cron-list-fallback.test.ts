import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// cronList() used to swallow a gateway RPC failure and fall back to
// ~/.openclaw/cron/jobs.json. OpenClaw moved that store into SQLite, so the
// file no longer exists and the fallback could only ever return [] — which the
// dashboard renders as "no cron jobs", indistinguishable from a genuinely
// empty schedule.
//
// That is what happened on 2026-09-01: an OpenClaw upgrade made every
// cron.list fail with AgentSelectionRequiredError for ~18h while the cron page
// calmly showed zero jobs, inviting the operator to recreate jobs that still
// existed. An error must stay an error.

// cron-cli reaches the gateway through the server's WebSocket, exposed as the
// global __gatewayRpc. Swapping that global is how the real transport is stood
// out of the way.
vi.mock('@/lib/db', () => ({ db: {} }))

const gatewayRpc = vi.fn()
let home: string
const realHome = process.env.HOME

beforeEach(() => {
  gatewayRpc.mockReset()
  ;(globalThis as any).__gatewayRpc = gatewayRpc
  home = mkdtempSync(join(tmpdir(), 'mcc-cron-'))
  process.env.HOME = home
})

afterEach(() => {
  delete (globalThis as any).__gatewayRpc
  process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

/** Write a legacy jobs.json, as pre-SQLite OpenClaw had. */
function writeLegacyJobsFile(jobs: unknown[]) {
  mkdirSync(join(home, '.openclaw', 'cron'), { recursive: true })
  writeFileSync(join(home, '.openclaw', 'cron', 'jobs.json'), JSON.stringify({ jobs }))
}

describe('cronList', () => {
  it('returns jobs from the gateway when the RPC works', async () => {
    gatewayRpc.mockResolvedValue({ jobs: [{ id: 'a', name: 'nightly' }] })
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    const jobs = await cronList()
    expect(jobs).toHaveLength(1)
  })

  it('rethrows when the RPC fails and there is no legacy file', async () => {
    // The modern case: jobs.json does not exist. Failing loudly is the point —
    // returning [] here is the bug this test exists to prevent.
    gatewayRpc.mockRejectedValue(new Error('AgentSelectionRequiredError: no explicit owner'))
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    await expect(cronList()).rejects.toThrow(/AgentSelectionRequiredError/)
  })

  it('never reports an empty schedule just because the gateway is down', async () => {
    gatewayRpc.mockRejectedValue(new Error('ECONNREFUSED'))
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    let returned: unknown = 'did-not-return'
    try { returned = await cronList() } catch { /* expected */ }
    expect(returned).not.toEqual([])
  })

  it('still uses the legacy file on OpenClaw versions that have one', async () => {
    writeLegacyJobsFile([{ id: 'old', name: 'legacy job' }])
    gatewayRpc.mockRejectedValue(new Error('gateway down'))
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    const jobs = await cronList()
    expect(jobs).toHaveLength(1)
  })

  it('rethrows when the legacy file exists but is corrupt', async () => {
    mkdirSync(join(home, '.openclaw', 'cron'), { recursive: true })
    writeFileSync(join(home, '.openclaw', 'cron', 'jobs.json'), '{ not json')
    gatewayRpc.mockRejectedValue(new Error('gateway down'))
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    await expect(cronList()).rejects.toThrow(/gateway down/)
  })

  it('an empty gateway response is still a legitimate empty schedule', async () => {
    gatewayRpc.mockResolvedValue({ jobs: [] })
    const { cronList } = await import('@/lib/morning-report/cron-cli')
    await expect(cronList()).resolves.toEqual([])
  })
})
