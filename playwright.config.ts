import { defineConfig } from '@playwright/test'
import { loadE2eEnv } from './tests/e2e/utils/env-e2e'

loadE2eEnv()

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  (process.env.E2E_SSH_HOST ? `http://${process.env.E2E_SSH_HOST}:3737` : 'http://localhost:3737')

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 10 * 60 * 1000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  outputDir: 'test-results/output',
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
      name: 'twnoc-deploy',
      testMatch: /tests\/e2e\/twnoc\/.*\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'mcc-login',
      testMatch: /tests\/e2e\/mcc-login\.setup\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'mcc',
      testIgnore: [/tests\/e2e\/twnoc\//, /tests\/e2e\/mcc-login\.setup\.ts/],
      dependencies: ['mcc-login'],
      use: {
        browserName: 'chromium',
        storageState: 'tests/e2e/storage/mcc-state.json',
      },
    },
  ],
})
