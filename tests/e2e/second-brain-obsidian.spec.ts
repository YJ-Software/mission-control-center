import { test, expect } from './fixtures/login'

/**
 * Full lifecycle smoke test for the /second-brain Obsidian installer
 * (headless Obsidian + Xvfb/VNC stack + CouchDB via Docker for LiveSync).
 * Cycle: install → verify → uninstall → verify clean → install again (idempotent).
 *
 * Heavy: Obsidian + Xvfb/VNC (~8-12 min) + CouchDB (~3-5 min); uninstall
 * ~3-5 min — so this test alone can take ~35 min on a clean box. On a clean
 * box the InstallPanel pre-checks both Obsidian and CouchDB, so a plain
 * 開始安裝 installs everything.
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test second-brain-obsidian
 */

const INSTALL_TIMEOUT = 18 * 60 * 1000
const PURGE_TIMEOUT = 6 * 60 * 1000

// The install/uninstall buttons disable themselves the moment they're clicked
// (isInstalling/uninstalling) and stay disabled for the whole (slow) operation.
// Plain click() re-checks actionability and would time out waiting for the
// button to re-enable, so force the click to dispatch once and move on.
const FORCE = { force: true } as const

const installBtnName = '開始安裝'
const installDone = '安裝完成！'
const uninstallBtnName = '解除安裝全部'
const confirmUninstall = '確定解除安裝'
const uninstallDone = '解除安裝完成'
const goToInstall = '前往安裝畫面'

test.describe('Second Brain — Obsidian setup', () => {
  test('install → uninstall → install (idempotent)', async ({ loggedInPage: page, baseURL }) => {
    // Two full installs + an uninstall blow past the 10-min global timeout.
    test.setTimeout(50 * 60 * 1000)
    await page.goto(`${baseURL}/second-brain`)
    // Obsidian is the default tab; clicking is a no-op but makes intent explicit.
    await page.getByRole('tab', { name: 'Obsidian' }).click()

    const installBtn = page.getByRole('button', { name: installBtnName })
    // The uninstall control lives on the (default) "overview" sub-tab once installed.
    const uninstallBtn = page.getByRole('button', { name: uninstallBtnName })

    // Normalize starting state.
    await expect(installBtn.or(uninstallBtn)).toBeVisible({ timeout: 20_000 })
    if (await uninstallBtn.isVisible().catch(() => false)) {
      await uninstallBtn.click()
      await page.getByRole('button', { name: confirmUninstall }).click(FORCE)
      await expect(page.getByText(uninstallDone)).toBeVisible({ timeout: PURGE_TIMEOUT })
      await page.getByRole('button', { name: goToInstall }).click()
    }

    // --- First install (Obsidian + CouchDB, both pre-checked on a clean box) ---
    await expect(installBtn).toBeVisible({ timeout: 10_000 })
    await installBtn.click(FORCE)
    await expect(page.getByText(installDone)).toBeVisible({ timeout: INSTALL_TIMEOUT })
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
