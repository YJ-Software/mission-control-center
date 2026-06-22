import { test, expect } from './fixtures/login'

/**
 * Wiki purpose switch (二選一: Agent 知識庫 ↔ 客服知識庫).
 *
 * Switching rewrites ~/.openclaw/openclaw.json and restarts the OpenClaw
 * gateway, so a single switch can take tens of seconds. This spec reads the
 * current purpose, flips to the other — verifying the About-tab badge flips and
 * the Manage-tab lock toggles — then flips back so the box is left as it
 * started. An afterEach restores the original purpose even if the body throws.
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test wiki-purpose
 */

type Purpose = 'agent' | 'customer-service'

const LABEL: Record<Purpose, string> = { agent: 'Agent 專用', 'customer-service': '客服專用' }
const CS_LOCK_TITLE = '目前 Wiki 用途為「客服專用」'
// A switch restarts the gateway — give the badge plenty of time to flip.
const SWITCH_TIMEOUT = 120_000

const purposeUrl = (baseURL: string) => `${baseURL}/api/second-brain/wiki?type=purpose`

// Captured at the start so afterEach can restore even on a mid-test failure.
let startPurpose: Purpose | null = null

test.afterEach(async ({ request, baseURL }) => {
  if (!startPurpose || !baseURL) return
  const cur = (await (await request.get(purposeUrl(baseURL))).json()).purpose
  if (cur !== startPurpose) {
    await request.post(`${baseURL}/api/second-brain/wiki?action=purpose`, {
      data: { purpose: startPurpose },
      timeout: 90_000,
    })
  }
  startPurpose = null
})

test('wiki purpose switch toggles the manage-tab lock (二選一)', async ({
  loggedInPage: page,
  baseURL,
  request,
}) => {
  test.setTimeout(6 * 60 * 1000)

  startPurpose = (await (await request.get(purposeUrl(baseURL!))).json()).purpose as Purpose
  expect(['agent', 'customer-service']).toContain(startPurpose)
  const other: Purpose = startPurpose === 'agent' ? 'customer-service' : 'agent'

  const openWikiSub = async (sub: '關於' | '管理') => {
    await page.goto(`${baseURL}/second-brain`)
    await page.getByRole('tab', { name: 'Wiki' }).click()
    await page.getByRole('tab', { name: sub }).click()
  }

  // From the About sub-tab, switch to `target` and wait for the badge to flip.
  // The "switch to" button always offers the OTHER purpose, so once it offers
  // the opposite of `target`, the current purpose has become `target`.
  const switchTo = async (target: Purpose) => {
    const opposite: Purpose = target === 'agent' ? 'customer-service' : 'agent'
    await openWikiSub('關於')
    await page.getByRole('button', { name: `切換為「${LABEL[target]}」` }).click({ timeout: 30_000 })
    await page.getByRole('button', { name: '確認切換' }).click()
    await expect(
      page.getByRole('button', { name: `切換為「${LABEL[opposite]}」` }),
    ).toBeVisible({ timeout: SWITCH_TIMEOUT })
  }

  // The Manage sub-tab shows the customer-service lock only under that purpose;
  // under the agent purpose the personal management surface is shown instead.
  const expectManageLock = async (purpose: Purpose) => {
    await openWikiSub('管理')
    if (purpose === 'customer-service') {
      await expect(page.getByText(CS_LOCK_TITLE)).toBeVisible({ timeout: 20_000 })
    } else {
      await expect(page.getByText(CS_LOCK_TITLE)).toHaveCount(0)
    }
  }

  // Flip to the other purpose and verify both surfaces reflect it.
  await switchTo(other)
  await expectManageLock(other)

  // Flip back to the original so the box ends as it started.
  await switchTo(startPurpose)
  await expectManageLock(startPurpose)

  // The API agrees with the restored UI state.
  const finalPurpose = (await (await request.get(purposeUrl(baseURL!))).json()).purpose
  expect(finalPurpose).toBe(startPurpose)
})
