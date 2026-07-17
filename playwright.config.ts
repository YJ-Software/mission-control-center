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
      // A real WHMCS deploy outlives the global 10-min budget: OpenClaw 2026.7.1's
      // startup-migration lease strands the gateway for its full 5-min TTL before
      // the playbook's self-healing wait recovers it, and MCC installs only after
      // that. Raised here rather than globally so the MCC specs keep a tight
      // budget and still surface hangs.
      timeout: 25 * 60 * 1000,
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
