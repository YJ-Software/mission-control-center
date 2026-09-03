import { test, expect } from './fixtures/login'

/**
 * The customer-facing chat window: no operator sidebar, one way through to the
 * full console, and the chat itself actually works. Landing behaviour is driven
 * by the `ui.landingPage` setting so an operator install is unaffected.
 */
test('/talk is a chat window without the operator shell, with a way into the full MCC', async ({
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

  // The chat works from here, not just renders. Count first: the panel restores
  // history, so an assistant message being present proves nothing — only a NEW
  // one does.
  const assistant = page.locator('[data-role="assistant"]')
  const before = await assistant.count()
  await input.fill('回我一個 OK')
  await input.press('Enter')
  await expect(assistant).not.toHaveCount(before, { timeout: 120_000 })
  await expect(async () => {
    expect((await assistant.last().innerText()).trim().length).toBeGreaterThan(0)
  }).toPass({ timeout: 120_000, intervals: [500, 1000, 2000] })

  // And the button really lands on the full console.
  await out.click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: /終端機|Terminal/ }).first()).toBeVisible({ timeout: 30_000 })
})
