import { test, expect } from './fixtures/login'

// Agent responses go through the local model (qwen-portal/coder-model on
// twnoc deploys) and have been observed at ~65s end-to-end. 3 min gives
// enough headroom without making a real hang silently linger forever.
const RUN_POLL_TIMEOUT = 3 * 60_000

test('cron-job: create + manual trigger + see run record', async ({ loggedInPage: page, baseURL, request }) => {
  // Unique name per run avoids interference from leftover jobs of past runs.
  const jobName = `e2e-test-job-${Date.now()}`
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
  const listResp = await request.get(`${baseURL}/api/cron`)
  expect(listResp.ok()).toBeTruthy()
  const { jobs } = await listResp.json()
  const job = jobs?.find((j: { name: string }) => j.name === jobName)
  expect(job?.id, `job ${jobName} not found in /api/cron list`).toBeTruthy()

  // Poll for a successful run record.
  await expect(async () => {
    const resp = await request.get(`${baseURL}/api/cron/runs?id=${job.id}&limit=1`)
    expect(resp.ok()).toBeTruthy()
    const json = await resp.json()
    expect(json.entries?.[0]?.status, 'last run status').toBe('ok')
  }).toPass({ timeout: RUN_POLL_TIMEOUT, intervals: [1_000, 2_000, 5_000] })
})
