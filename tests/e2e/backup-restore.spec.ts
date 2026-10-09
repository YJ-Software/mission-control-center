import { test, expect } from './fixtures/login'
import { sendChatAndExpectReply } from './utils/chat-turn'

/**
 * Round trip: MCC backup (OpenClaw native backup + MCC DB, one archive) ->
 * dry-run restore -> real restore job (swaps ~/.openclaw, stages the DB,
 * restarts MCC) -> verify state went back to backup time and chat still works.
 *
 * The marker cron is created AFTER the backup, so it must be gone after the
 * restore; that is what proves the state really rolled back.
 *
 * Destructive on the target machine: throwaway only (like every E2E here).
 */

const BACKUP_TIMEOUT = 5 * 60_000
const RESTORE_TIMEOUT = 10 * 60_000

type Api = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>

test.describe.configure({ mode: 'serial' })

test('backup -> restore -> health, plugins, marker cron, chat', async ({ loggedInPage: page, baseURL }) => {
  test.setTimeout(25 * 60_000)
  if (!baseURL) throw new Error('baseURL undefined')

  let cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ')
  const api: Api = async (method, path, body, headers = {}) => {
    const r = await fetch(`${baseURL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }

  let archivePath: string | null = null
  let markerId: string | null = null
  const markerName = `e2e-backup-marker-${Date.now()}`

  try {
    // ── 1. Backup ────────────────────────────────────────────────────
    const dash = await api('GET', '/api/backup?type=dashboard')
    expect(dash.status).toBe(200)
    const token: string = dash.body.backupToken
    expect(token, 'backupToken exposed by /api/backup?type=dashboard').toBeTruthy()
    const tokenHeader = { 'X-Backup-Token': token }

    // Baseline facts. There is NO API endpoint listing OpenClaw plugins
    // (/api/services returns systemd services, not plugins), so the plugin
    // count cannot be compared here; the restore job's own verify phase and
    // the chat check below cover plugin-dependent breakage. Compare service
    // states are not compared either (restart timing makes that flaky).

    const run = await api('POST', '/api/backup/run', { triggeredBy: 'api' }, tokenHeader)
    expect(run.status, `backup run: ${JSON.stringify(run.body)}`).toBe(200)
    const logId: number = run.body.logId
    expect(logId).toBeTruthy()

    let log: any
    await expect(async () => {
      const r = await api('GET', `/api/backup/logs?logId=${logId}`)
      log = r.body
      expect(log, 'backup log row').toBeTruthy()
      if (log.status === 'failed' || log.status === 'canceled') {
        throw Object.assign(new Error(`backup ${log.status}: ${log.error}`), { name: 'FatalBackup' })
      }
      expect(log.status).toBe('completed')
    }).toPass({ timeout: BACKUP_TIMEOUT, intervals: [2_000, 3_000, 5_000] })

    archivePath = log.filePath as string
    expect(archivePath.split('/').pop()!.startsWith('mcc-backup_openclaw_'), `archive name: ${archivePath}`).toBe(true)
    expect(log.fileSize).toBeGreaterThan(0)

    // ── 2. Marker cron, created AFTER the backup ─────────────────────
    const add = await api('POST', '/api/cron', {
      name: markerName,
      schedule: '0 0 1 1 *',
      message: 'e2e backup marker, never runs',
      deliveryMode: 'none',
    })
    expect(add.status, `cron add: ${JSON.stringify(add.body)}`).toBe(200)
    markerId = add.body.id
    expect(markerId).toBeTruthy()
    expect((await listCronNames(api)).includes(markerName), 'marker cron listed').toBe(true)

    // ── 3. Dry run ───────────────────────────────────────────────────
    const dry = await api('POST', '/api/backup/restore', { file: archivePath, dryRun: true }, tokenHeader)
    expect(dry.status, `dry run: ${JSON.stringify(dry.body)}`).toBe(200)
    expect(dry.body.kind).toBe('mcc')
    expect(dry.body.output).toMatch(/後端：\S+ \S+/)
    expect(dry.body.output).not.toContain('版本未知')
    expect(dry.body.output).toContain('.env.local 不會自動還原')

    // ── 4. Real restore ──────────────────────────────────────────────
    const rs = await api('POST', '/api/backup/restore', { file: archivePath, triggeredBy: 'api' }, tokenHeader)
    expect(rs.status, `restore: ${JSON.stringify(rs.body)}`).toBe(200)
    const jobId: string = rs.body.jobId
    expect(jobId).toBeTruthy()

    // MCC restarts mid-job: connection errors and 5xx are expected meanwhile.
    const deadline = Date.now() + RESTORE_TIMEOUT
    let last: any = null
    let done = false
    while (Date.now() < deadline) {
      try {
        const r = await api('GET', `/api/jobs/${jobId}`)
        if (r.status === 200 && r.body?.meta) {
          last = r.body
          const st = last.meta.status
          if (st === 'success') { done = true; break }
          if (st === 'failed' || st === 'cancelled') {
            throw new Error(`restore job ${st}: ${logTail(last)}`)
          }
        }
        // 401 right after restart (session not valid yet) or 404/5xx: keep polling.
      } catch (e) {
        if ((e as Error).message.startsWith('restore job')) throw e
      }
      await new Promise(r => setTimeout(r, 3_000))
    }
    expect(done, `restore job did not reach success within 10 min; last: ${last ? `${last.meta.status} ${logTail(last)}` : 'no response'}`).toBe(true)

    // ── 5. Wait for the actual MCC restart and the DB apply ─────────
    // The runner marks the job 'success' as soon as the last phase has
    // *scheduled* the restart (~2 s before it happens), so 'success' alone
    // proves neither the restart nor the DB swap. No API exposes the process
    // start time, so the restart is detected by the boot-time DB apply itself:
    // a lastDbRestore whose `at` is later than the restore job's start (both
    // server clock) can only have been written by the new process.
    const restoreStartedAt = Date.parse(last.meta.startedAt)
    expect(Number.isNaN(restoreStartedAt), `restore job startedAt: ${last.meta.startedAt}`).toBe(false)

    // The restored DB holds the sessions as of backup time. That probably
    // includes ours, but do not assume: re-login if the cookie is rejected.
    const relogin = async () => {
      const password = process.env.AUTH_PASSWORD
      if (!password) throw new Error('AUTH_PASSWORD not set')
      const r = await fetch(`${baseURL}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      })
      expect(r.status, 'relogin after restore').toBe(200)
      const setCookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
      expect(setCookie).toContain('mc_session=')
      cookie = setCookie
      await page.context().addCookies([{ name: 'mc_session', value: setCookie.split('mc_session=')[1].split(';')[0], url: baseURL }])
    }

    const seen: { lastDbRestore?: { result: string; at: string; detail: string } } = {}
    await expect(async () => {
      let d: { status: number; body: any }
      try {
        d = await api('GET', '/api/backup?type=dashboard')
      } catch (e) {
        throw new Error(`dashboard API unreachable (MCC restarting?): ${(e as Error).message}`)
      }
      if (d.status === 401) {
        await relogin()
        d = await api('GET', '/api/backup?type=dashboard')
      }
      expect(d.status, 'GET /api/backup?type=dashboard').toBe(200)
      const ldr = d.body.lastDbRestore
      expect(ldr, 'lastDbRestore not written yet (MCC has not restarted)').toBeTruthy()
      expect(Date.parse(ldr.at), `lastDbRestore.at ${ldr.at} must be after restore start ${last.meta.startedAt}`)
        .toBeGreaterThan(restoreStartedAt)
      seen.lastDbRestore = ldr
    }).toPass({ timeout: 3 * 60_000, intervals: [2_000, 3_000, 5_000] })
    expect(seen.lastDbRestore?.result, `MCC DB restore on boot: ${JSON.stringify(seen.lastDbRestore)}`).toBe('applied')

    await expect(async () => {
      const h = await fetch(`${baseURL}/api/health`)
      expect(h.status).toBe(200)
    }).toPass({ timeout: 2 * 60_000, intervals: [2_000, 5_000] })

    const authed = async () => (await api('GET', '/api/cron')).status !== 401
    if (!(await authed())) await relogin()

    // The restored DB is the snapshot inside the archive, in which this very
    // backup was already recorded as completed with its final path (fa3ca7b).
    const restoredLog = await api('GET', `/api/backup/logs?logId=${logId}`)
    expect(restoredLog.status).toBe(200)
    expect(restoredLog.body?.status, `backup row in restored DB: ${JSON.stringify(restoredLog.body)}`).toBe('completed')
    expect(restoredLog.body?.filePath).toBe(archivePath)

    // Gateway comes back after the OpenClaw dir swap; cron list throws (503)
    // rather than returning [] while it is unreachable, so retrying is safe.
    let names: string[] = []
    await expect(async () => { names = await listCronNames(api) }).toPass({ timeout: 3 * 60_000, intervals: [3_000, 5_000] })
    expect(names.includes(markerName), 'marker cron must be gone after restore').toBe(false)
    markerId = null // nothing to clean up

    await sendChatAndExpectReply(page, baseURL, '回我一個 OK')
  } finally {
    // Only delete what this run created.
    if (markerId) await api('DELETE', `/api/cron?id=${encodeURIComponent(markerId)}`).catch(() => {})
    if (archivePath) await api('POST', '/api/backup?action=delete', { file: archivePath }).catch(() => {})
  }
})

async function listCronNames(api: Api): Promise<string[]> {
  const r = await api('GET', '/api/cron')
  if (r.status !== 200) throw new Error(`GET /api/cron -> ${r.status}`)
  return (r.body.jobs ?? []).map((j: { name: string }) => j.name)
}

function logTail(job: { log?: unknown }): string {
  const log = job.log
  const lines = Array.isArray(log) ? log : typeof log === 'string' ? log.split('\n') : []
  return lines.slice(-15).map((l: any) => (typeof l === 'string' ? l : l.text)).join(' | ')
}
