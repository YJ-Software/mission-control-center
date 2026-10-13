import { test, expect } from './fixtures/login'
import { sendChatTurnOnCurrentPage } from './utils/chat-turn'

/**
 * The customer-facing chat window: no operator sidebar, one way through to the
 * full console, and the chat itself actually works. Landing behaviour is driven
 * by the `ui.landingPage` setting so an operator install is unaffected.
 */
test('/talk is a chat window without the operator shell, with a way into the full MCC and back', async ({
  loggedInPage: page, baseURL,
}) => {
  await page.goto(`${baseURL}/talk`)

  // The chat input is the point of the page.
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 30_000 })

  // The operator shell must NOT be here: no sidebar nav links.
  await expect(page.getByRole('link', { name: /儀表板|Dashboard/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /終端機|Terminal/ })).toHaveCount(0)

  // …but there is exactly one deliberate way out, and it goes to the dashboard.
  const out = page.getByRole('link', { name: /完整控制台|Full console/i })
  await expect(out).toBeVisible()
  await expect(out).toHaveAttribute('href', '/dashboard')

  // The chat works from here, not just renders. The shared helper waits for the
  // reply to THIS message (the panel restores history, so a pre-existing
  // assistant bubble proves nothing) and fails on an error state or on
  // OpenClaw's failure text — a 401 "Couldn't sign in to the AI service" also
  // renders as a non-empty bubble and used to pass here.
  await sendChatTurnOnCurrentPage(page, '回我一個 OK', { timeout: 120_000 })

  // And the button really lands on the full console.
  await out.click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: /終端機|Terminal/ }).first()).toBeVisible({ timeout: 30_000 })

  // …and the full console has a way back: the header's /talk button returns to
  // the chat window, so an operator who stepped out is not stranded.
  const back = page.locator('header a[href="/talk"]')
  await expect(back).toBeVisible({ timeout: 30_000 })
  await back.click()
  await expect(page).toHaveURL(/\/talk$/)
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: /終端機|Terminal/ })).toHaveCount(0)
})
