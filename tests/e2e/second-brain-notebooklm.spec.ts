import { test, expect } from './fixtures/login'

/**
 * Lightweight /second-brain NotebookLM tab check. NotebookLM has no installer
 * on this page (install lives on /setup, covered by setup-notebooklm.spec.ts);
 * here we verify the tab correctly reflects the INSTALLED state.
 *
 * We ensure nlm is installed via the (idempotent) setup API first — this spec
 * runs before setup-notebooklm.spec.ts in file order, and the install is a
 * no-op when nlm is already present.
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test second-brain-notebooklm
 */

const INSTALL_TIMEOUT = 6 * 60 * 1000

test('second-brain NotebookLM tab reflects installed status', async ({
  loggedInPage: page,
  baseURL,
  request,
}) => {
  // Ensure nlm is installed so we can assert the "installed" tab rendering.
  const status = await (await request.get(`${baseURL}/api/setup/notebooklm`)).json()
  if (!status?.nlm?.installed) {
    await request.post(`${baseURL}/api/setup/notebooklm`, {
      data: { action: 'install' },
      timeout: INSTALL_TIMEOUT,
    })
    await expect(async () => {
      const s = await (await request.get(`${baseURL}/api/setup/notebooklm`)).json()
      expect(s?.nlm?.installed).toBeTruthy()
    }).toPass({ timeout: INSTALL_TIMEOUT, intervals: [2_000, 5_000, 10_000] })
  }

  await page.goto(`${baseURL}/second-brain`)
  await page.getByRole('tab', { name: 'NotebookLM' }).click()

  // Installed → the auth-status card shows (尚未登入, since there is no Google
  // login on a fresh box), and the "尚未安裝 / go to setup" prompt is gone.
  await expect(page.getByText('尚未登入')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/NotebookLM CLI 尚未安裝/)).not.toBeVisible()
})
