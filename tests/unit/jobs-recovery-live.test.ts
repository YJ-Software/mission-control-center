import { describe, it, expect, vi, afterEach } from 'vitest'

vi.hoisted(() => {
  const fsx = require('node:fs') as typeof import('node:fs')
  const osx = require('node:os') as typeof import('node:os')
  const pathx = require('node:path') as typeof import('node:path')
  process.env.MISSION_CONTROL_DATA_DIR = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mcc-recovery-live-'))
})

import { upsertJobMeta, readAllJobsSync } from '@/lib/jobs/store'
import { markJobLive, markJobDone } from '@/lib/jobs/live'
import { runOrphanRecoveryOnce } from '@/lib/jobs/recovery'
import type { JobMeta } from '@/lib/jobs/types'

afterEach(() => { vi.useRealTimers() })

describe('runOrphanRecoveryOnce', () => {
  // 每個 bundle 第一次呼叫時會跑一次「超過 10 分鐘就當孤兒」的回收。它若不看本行程是否
  // 正在執行，會把一個跑了 11 分鐘、仍在進行的 openclaw update 標成 failed，
  // 備份排程的 guard 就不再擋，備份會在升級途中開跑（final re-review N1）。
  it('本行程仍在執行中的 job 即使超過 10 分鐘也不被當成孤兒', () => {
    const startedAt = new Date('2026-10-09T08:00:00Z')
    const live: JobMeta = {
      id: 'live-upgrade', kind: 'upgrade-openclaw', label: 'Upgrade OpenClaw', status: 'running',
      startedAt: startedAt.toISOString(), finishedAt: null, exitCode: null, triggeredBy: 'api', phases: [],
    }
    const dead: JobMeta = { ...live, id: 'dead-upgrade' }
    upsertJobMeta(live)
    upsertJobMeta(dead)
    markJobLive('live-upgrade')
    try {
      vi.useFakeTimers({ now: new Date(startedAt.getTime() + 11 * 60_000), toFake: ['Date'] })
      runOrphanRecoveryOnce()
      const byId = Object.fromEntries(readAllJobsSync().map((j) => [j.id, j.status]))
      expect(byId['live-upgrade']).toBe('running')
      expect(byId['dead-upgrade']).toBe('failed')
    } finally {
      markJobDone('live-upgrade')
    }
  })
})
