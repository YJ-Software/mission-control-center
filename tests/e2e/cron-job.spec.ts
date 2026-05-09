import { test, expect } from './fixtures/login'

const RUN_POLL_TIMEOUT = 60_000

test('cron-job: create + manual trigger + see run record', async ({ loggedInPage: page, baseURL, request }) => {
  await page.goto(`${baseURL}/cron-jobs`)

  // Create — UI button labeled "新增" or "Create" depending on locale
  await page.getByRole('button', { name: /新增|Create|New/i }).first().click()

  // Form: name + cron + command. Adjust if first dry-run reveals different selectors.
  await page.getByRole('textbox', { name: /名稱|Name/i }).fill('e2e-test-job')
  await page.getByRole('textbox', { name: /排程|Cron|Schedule/i }).fill('0 0 1 1 *')
  await page.getByRole('textbox', { name: /命令|Command/i }).fill('echo e2e')
  await page.getByRole('button', { name: /儲存|Save|Submit/i }).click()

  await expect(page.getByText('e2e-test-job')).toBeVisible({ timeout: 10_000 })

  // Trigger the job — find row and click 立即執行 / Run-now button.
  const row = page.getByRole('row', { name: /e2e-test-job/ })
  await row.getByRole('button', { name: /立即執行|Run\s*Now|Trigger/i }).click()

  // Poll API for the run record.
  await expect(async () => {
    const resp = await request.get(`${baseURL}/api/cron/runs?name=e2e-test-job&limit=1`)
    expect(resp.ok()).toBeTruthy()
    const json = await resp.json()
    expect(json.runs?.[0]?.status, 'last run status').toBe('success')
  }).toPass({ timeout: RUN_POLL_TIMEOUT, intervals: [1_000, 2_000, 5_000] })
})
