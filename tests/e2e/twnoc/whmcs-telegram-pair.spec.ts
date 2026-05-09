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

  await page.goto(process.env.WHMCS_LOGIN_URL!)
  await page.getByRole('textbox', { name: /Email/i }).fill(process.env.WHMCS_USER!)
  await page.getByRole('textbox', { name: /密碼|Password/i }).fill(process.env.WHMCS_PASSWORD!)
  await page.getByRole('button', { name: /登入|Log\s*In/i }).click()

  await page.getByRole('button', { name: /檢視詳情/ }).first().click()
  await page.getByRole('link', { name: /OpenClaw 部署/ }).click()
  // 部署列表頁 → 開啟最近一筆完成的部署的詳情，會顯示 Telegram 配對 form
  await page.getByRole('row').filter({ hasText: /成功/ }).first().getByRole('link').first().click()

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
