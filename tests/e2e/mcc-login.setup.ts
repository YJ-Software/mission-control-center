import { test as setup, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const STORAGE_PATH = resolve(process.cwd(), 'tests/e2e/storage/mcc-state.json')

setup('authenticate', async ({ page, baseURL }) => {
  const password = process.env.AUTH_PASSWORD
  if (!password) throw new Error('AUTH_PASSWORD not set — Phase 2 should have populated it')

  await page.goto(`${baseURL}/login`)
  await page.getByRole('textbox').fill(password)
  await page.getByRole('button', { name: /登入|Log\s*In/i }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  mkdirSync(resolve(process.cwd(), 'tests/e2e/storage'), { recursive: true })
  await page.context().storageState({ path: STORAGE_PATH })
})
