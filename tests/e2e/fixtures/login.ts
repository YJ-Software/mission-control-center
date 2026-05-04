import { test as base, expect, type Page } from '@playwright/test'

/**
 * Shared fixture that logs into Mission Control with the dashboard
 * password before every test. Password is read from:
 *   - AUTH_PASSWORD env var (set this on the test runner)
 */
export const test = base.extend<{ loggedInPage: Page }>({
  loggedInPage: async ({ page, baseURL }, use) => {
    const password = process.env.AUTH_PASSWORD
    if (!password) {
      throw new Error('Set AUTH_PASSWORD env var to run e2e tests')
    }

    await page.goto(`${baseURL}/login`)
    await page.getByRole('textbox').fill(password)
    await page.getByRole('button', { name: /登入|Log\s*In/i }).click()

    // Wait for redirect out of /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
    await use(page)
  },
})

export { expect }
