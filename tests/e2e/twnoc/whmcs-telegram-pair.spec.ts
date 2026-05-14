import { test, expect } from '@playwright/test'
import { makeClient, dmBotAndAwaitReply } from '../../../scripts/e2e/twnoc/lib/gramjs-client.mjs'

test.describe.configure({ mode: 'serial' })

test('telegram pair via gramjs', async ({ page }) => {
  const botToken = process.env.TEST_TELEGRAM_BOT_TOKEN
  const botUsername = process.env.TEST_BOT_USERNAME
  const apiId = process.env.TG_API_ID
  const apiHash = process.env.TG_API_HASH
  const session = process.env.TG_USER_SESSION
  test.skip(!botToken || !botUsername || !apiId || !apiHash || !session,
    'requires TEST_TELEGRAM_BOT_TOKEN / TEST_BOT_USERNAME / TG_API_ID / TG_API_HASH / TG_USER_SESSION')

  const rebuildPwd = process.env.E2E_REBUILD_PASSWORD

  // Auto-accept 開始部署 confirm
  page.on('dialog', d => { d.accept().catch(() => {}) })

  // Login
  await page.goto(process.env.WHMCS_LOGIN_URL!)
  await page.getByRole('textbox', { name: /Email/i }).fill(process.env.WHMCS_USER!)
  await page.getByRole('textbox', { name: /密碼|Password/i }).fill(process.env.WHMCS_PASSWORD!)
  await page.getByRole('button', { name: /登入|Log\s*In/i }).click()
  await page.waitForLoadState('networkidle')

  // We can't reuse phase 2's deploy here. The Telegram pair form lives only on
  // deploying.php, and WHMCS treats the first visit to that page as the user
  // ack'ing the deploy — at which point the underlying SSH session is closed
  // and the form returns "SSH session expired" on submit. Phase 2's deploy
  // spec already consumed that one-shot window when it read AUTH_PASSWORD, so
  // this spec triggers its OWN deploy and stays on deploying.php for the
  // entire pairing flow.
  await page.getByRole('button', { name: /檢視詳情/ }).first().click()
  await page.getByRole('link', { name: /OpenClaw 部署/ }).click()

  // WHMCS refuses '新增部署' while any row is still 執行中, even if the deploy
  // is server-side complete. The row only flips after someone visits the
  // corresponding deploying.php page (that visit acks the deploy). Phase 2's
  // deploy spec already did that visit in its own Playwright context, but the
  // ack doesn't propagate cross-session — so do it again here, in this
  // browser, for every leftover 執行中 row before we trigger a new deploy.
  const deployListUrl = page.url()
  for (let attempt = 0; attempt < 5; attempt++) {
    const inProgressHrefs = await page.locator('tr[data-href*="deploying.php"]').evaluateAll(
      (rows) => rows.map(r => (r as HTMLElement).getAttribute('data-href')).filter((h): h is string => !!h),
    )
    if (inProgressHrefs.length === 0) break
    for (const href of inProgressHrefs) {
      await page.goto(new URL(href, deployListUrl).href)
    }
    await page.goto(deployListUrl)
  }

  await page.getByRole('button', { name: /新增部署/ }).click()
  if (rebuildPwd) {
    await page.getByRole('radio', { name: /已變更/ }).check()
    await page.getByRole('textbox', { name: /SSH 密碼/ }).fill(rebuildPwd)
  }
  await page.getByRole('button', { name: /開始部署/ }).click()

  // Wait for deploy success on deploying.php — its label-success appears the
  // moment Ansible finishes. Telegram form is rendered alongside.
  await expect(page.locator('.label-success').filter({ hasText: '成功' })).toBeVisible({
    timeout: 10 * 60_000,
  })

  // Step 1: token → 設定
  await expect(page.locator('#tg-bot-token')).toBeVisible({ timeout: 30_000 })
  await page.locator('#tg-bot-token').fill(botToken!)
  await page.locator('#tg-configure-btn').click()
  await expect(page.locator('#tg-pairing-code')).toBeVisible({ timeout: 30_000 })

  // Step 2: gramjs DMs the bot, parse pairing code from reply
  const client = makeClient({ apiId: apiId!, apiHash: apiHash!, session: session! })
  let pairingCode: string
  try {
    const reply = await dmBotAndAwaitReply(client, {
      botUsername: botUsername!,
      text: '/start',
      timeoutMs: 60_000,
    })
    const m = reply.match(/Pairing code:\s*\n*\s*([A-Z0-9]+)/i)
    if (!m) throw new Error(`unexpected reply: ${reply.slice(0, 200)}`)
    pairingCode = m[1]
    console.log(`[telegram-pair] code=${pairingCode}`)
  } finally {
    await client.disconnect()
  }

  // Step 3: paste + 配對
  await page.locator('#tg-pairing-code').fill(pairingCode)
  await page.locator('#tg-pair-btn').click()

  // Step 4: success message
  await expect(
    page.getByText(/配對成功！您現在可以在 Telegram 與 AI 聊天了。/)
  ).toBeVisible({ timeout: 30_000 })
})
