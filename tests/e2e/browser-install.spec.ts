import { test, expect } from './fixtures/login'

/**
 * Full lifecycle smoke test for the /browser installer (headless Chrome +
 * Xvfb + Openbox + x11vnc + websockify + systemd user services).
 * Cycle: install → verify → uninstall → verify clean → install again (idempotent).
 *
 * Heavy: a fresh install downloads Chrome + builds the VNC stack (~10-15 min),
 * uninstall ~2-3 min — so this test alone can take ~30 min on a clean box.
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test browser-install
 */

const INSTALL_TIMEOUT = 15 * 60 * 1000
const PURGE_TIMEOUT = 5 * 60 * 1000

// The install/uninstall buttons disable themselves the moment they're clicked
// (isInstalling/uninstalling) and stay disabled for the whole (slow) operation.
// Plain click() re-checks actionability and would time out waiting for the
// button to re-enable, so force the click to dispatch once and move on.
const FORCE = { force: true } as const

const installBtnName = '開始安裝'
const installDone = '安裝完成！'
const uninstallBtnName = '解除安裝瀏覽器'
const confirmUninstall = '確定解除安裝'
const uninstallDone = '解除安裝完成'
const goToInstall = '前往安裝畫面'

test.describe('Browser (headless Chrome + VNC) setup', () => {
  test('install → uninstall → install (idempotent)', async ({ loggedInPage: page, baseURL }) => {
    // Two full installs + an uninstall blow past the 10-min global timeout.
    test.setTimeout(45 * 60 * 1000)
    await page.goto(`${baseURL}/browser`)

    const installBtn = page.getByRole('button', { name: installBtnName })
    const uninstallBtn = page.getByRole('button', { name: uninstallBtnName })

    // Normalize starting state: the page shows the InstallPanel (開始安裝) when
    // not installed, or the dashboard + SettingsPanel (解除安裝瀏覽器) when it is.
    await expect(installBtn.or(uninstallBtn)).toBeVisible({ timeout: 20_000 })
    if (await uninstallBtn.isVisible().catch(() => false)) {
      await uninstallBtn.click()
      await page.getByRole('button', { name: confirmUninstall }).click(FORCE)
      await expect(page.getByText(uninstallDone)).toBeVisible({ timeout: PURGE_TIMEOUT })
      await page.getByRole('button', { name: goToInstall }).click()
    }

    // --- First install ---
    await expect(installBtn).toBeVisible({ timeout: 10_000 })
    await installBtn.click(FORCE)
    await expect(page.getByText(installDone)).toBeVisible({ timeout: INSTALL_TIMEOUT })
    // Install panel auto-navigates to the dashboard ~2s after done; the
    // uninstall control then becomes available.
    await expect(uninstallBtn).toBeVisible({ timeout: 30_000 })

    // --- Uninstall ---
    await uninstallBtn.click()
    await page.getByRole('button', { name: confirmUninstall }).click(FORCE)
    await expect(page.getByText(uninstallDone)).toBeVisible({ timeout: PURGE_TIMEOUT })
    await page.getByRole('button', { name: goToInstall }).click()

    // --- Second install (idempotency) ---
    await expect(installBtn).toBeVisible({ timeout: 10_000 })
    await installBtn.click(FORCE)
    await expect(page.getByText(installDone)).toBeVisible({ timeout: INSTALL_TIMEOUT })
  })
})
