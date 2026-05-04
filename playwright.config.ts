import { defineConfig } from '@playwright/test'

// Base URL resolution order:
// 1. PLAYWRIGHT_BASE_URL env var (highest priority — use when testing a remote env)
// 2. Default: http://localhost:3737 (for when dev server is running locally)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3737'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 10 * 60 * 1000, // install flows can legitimately take up to ~5min
  expect: { timeout: 10_000 },
  fullyParallel: false, // install/uninstall tests mutate shared system state
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
