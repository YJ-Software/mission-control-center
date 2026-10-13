import type { APIRequestContext } from '@playwright/test'
import { test, expect } from './fixtures/login'

// Agent responses go through the local model (qwen-portal/coder-model on
// twnoc deploys) and have been observed at ~65s end-to-end. 3 min gives
// enough headroom without making a real hang silently linger forever.
const RUN_POLL_TIMEOUT = 3 * 60_000

/** Every job this spec creates is named `e2e-test-job-<epoch ms>`. */
const JOB_PREFIX = 'e2e-test-job-'
const isSpecJob = (name: unknown) =>
  typeof name === 'string' && name.startsWith(JOB_PREFIX) && /^\d+$/.test(name.slice(JOB_PREFIX.length))

interface CronJob { id: string; name: string }

/**
 * Lists jobs through MCC's cron API (gateway `cron.list`; only OpenClaw older
 * than 2026.5 may fall back to reading jobs.json). Deletes always go through
 * the gateway's `cron.remove`.
 */
async function listJobs(request: APIRequestContext, baseURL: string): Promise<CronJob[]> {
  const resp = await request.get(`${baseURL}/api/cron`)
  // A 503 means the gateway couldn't be asked; its `jobs: []` is not "none".
  if (!resp.ok()) throw new Error(`GET /api/cron -> ${resp.status()}: ${(await resp.text()).slice(0, 300)}`)
  return ((await resp.json()).jobs ?? []) as CronJob[]
}

/**
 * Deletes every job matching `match` and checks the list no longer has any.
 * The spec used to delete nothing, so each run (passing or failing) left its
 * `e2e-test-job-*` cron behind on the throwaway.
 */
async function removeJobs(request: APIRequestContext, baseURL: string, match: (job: CronJob) => boolean) {
  const doomed = (await listJobs(request, baseURL)).filter(match)
  for (const job of doomed) {
    const resp = await request.delete(`${baseURL}/api/cron?id=${encodeURIComponent(job.id)}`)
    if (!resp.ok()) throw new Error(`DELETE /api/cron?id=${job.id} (${job.name}) -> ${resp.status()}: ${(await resp.text()).slice(0, 300)}`)
  }
  const left = (await listJobs(request, baseURL)).filter(match)
  if (left.length) throw new Error(`cron jobs still present after delete: ${left.map((j) => `${j.name} (${j.id})`).join(', ')}`)
  return doomed
}

let jobName = ''

// Leftovers from earlier runs (including ones that crashed before this
// cleanup existed) would otherwise pile up on the box. Assumes one runner per
// box: a second session running this spec at the same time would have its
// in-flight job swept here as a leftover.
test.beforeEach(async ({ request, baseURL }) => {
  const removed = await removeJobs(request, baseURL!, (j) => isSpecJob(j.name))
  if (removed.length) console.log(`[cron-job] removed ${removed.length} leftover job(s): ${removed.map((j) => j.name).join(', ')}`)
})

// Runs on failure too. Matched by name, not id: the UI may have created the
// job before the test failed and never learned its id.
test.afterEach(async ({ request, baseURL }) => {
  if (!jobName) return
  const name = jobName
  jobName = ''
  await removeJobs(request, baseURL!, (j) => j.name === name)
})

test('cron-job: create + manual trigger + see run record', async ({ loggedInPage: page, baseURL, request }) => {
  // Unique name per run avoids interference from leftover jobs of past runs.
  jobName = `${JOB_PREFIX}${Date.now()}`
  await page.goto(`${baseURL}/cron-jobs`)

  // Open the create dialog — page-level button is "新增排程".
  await page.getByRole('button', { name: /新增排程|Create|New/i }).first().click()

  // The form's <label>s aren't aria-linked to inputs, so getByRole({ name })
  // doesn't work. Address fields by their placeholder text instead.
  await page.getByPlaceholder(/例：每日報告/).fill(jobName)
  await page.getByPlaceholder(/分 時 日 月 週/).fill('0 0 1 1 *')
  // cron-jobs run an agent with a prompt, not a shell command.
  await page.getByPlaceholder(/告訴 agent 要做什麼/).fill('回我一個 OK')
  // Fresh installs have no channel history, so the default "announce → last"
  // delivery would always fail. Switch to 不傳送 (none).
  await page.getByRole('dialog').getByRole('button', { name: /^不傳送$|^None$/ }).click()

  // Save — the dialog's confirm button mirrors the page button label.
  await page.getByRole('dialog').getByRole('button', { name: /新增排程|Save|Submit/i }).click()

  await expect(page.getByText(jobName)).toBeVisible({ timeout: 10_000 })

  // Cards collapse by default; click to expand, then the 立即執行 button
  // is revealed in the detail panel.
  await page.getByText(jobName).first().click()
  await page.getByRole('button', { name: /立即執行|Run\s*Now|Trigger/i }).first().click()

  // The runs API filters by job UUID, not name; look it up first.
  const job = (await listJobs(request, baseURL!)).find((j) => j.name === jobName)
  expect(job?.id, `job ${jobName} not found in /api/cron list`).toBeTruthy()

  // Wait for the run record, then judge it once. Retrying until it reads "ok"
  // kept polling a finished "error" run for the full 3 minutes.
  let last: { status?: string } | undefined
  await expect(async () => {
    const resp = await request.get(`${baseURL}/api/cron/runs?id=${job!.id}&limit=1`)
    expect(resp.ok()).toBeTruthy()
    last = (await resp.json()).entries?.[0]
    expect(last?.status, 'no finished run record yet').toBeTruthy()
    expect(last!.status, 'run still in progress').not.toMatch(/^(running|queued|pending|started)$/i)
  }).toPass({ timeout: RUN_POLL_TIMEOUT, intervals: [1_000, 2_000, 5_000] })
  expect(last!.status, `last run status (${JSON.stringify(last).slice(0, 400)})`).toBe('ok')
})
