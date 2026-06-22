import { test, expect } from './fixtures/login'

/**
 * Install + verify for the /second-brain Obsidian installer (headless Obsidian
 * + Xvfb/VNC stack + CouchDB via Docker for LiveSync).
 *
 * Install→verify only. The uninstall→reinstall idempotency cycle is
 * intentionally omitted: obsidian-headless (Electron) currently core-dumps
 * (SIGTRAP) when reinstalled after an uninstall — tracked as a separate, deeper
 * bug (see memory). On a clean box the InstallPanel pre-checks both Obsidian and
 * CouchDB, so a plain 開始安裝 installs everything.
 *
 *   PLAYWRIGHT_BASE_URL=http://<host>:3737 AUTH_PASSWORD=<pw> \
 *     npx playwright test second-brain-obsidian
 */

const INSTALL_TIMEOUT = 18 * 60 * 1000

const installBtnName = '開始安裝'
const installDone = '安裝完成！'
// Present on the installed dashboard (overview sub-tab); used to verify success.
const uninstallBtnName = '解除安裝全部'
// Once installed, the dashboard defaults to the 關於 (about) sub-tab; the
// uninstall control lives on the 總覽 (overview) sub-tab.
const overviewSubTabName = '總覽'

// The install button disables itself the moment it's clicked (isInstalling) and
// stays disabled for the whole slow install; plain click() would time out
// re-checking actionability, so force the click to dispatch once.
const FORCE = { force: true } as const

test.describe('Second Brain — Obsidian setup', () => {
  test('install → verify', async ({ loggedInPage: page, baseURL }) => {
    // A full Obsidian + CouchDB install blows past the 10-min global timeout.
    test.setTimeout(25 * 60 * 1000)

    const installBtn = page.getByRole('button', { name: installBtnName })
    const uninstallBtn = page.getByRole('button', { name: uninstallBtnName })
    const obsidianTab = page.getByRole('tab', { name: 'Obsidian' })
    const overviewSubTab = page.getByRole('tab', { name: overviewSubTabName })

    // Open the Obsidian tab and wait for the obsidian-config GET to resolve. On
    // every navigation a brief InstallPanel flash renders (config still loading,
    // nothing detected yet) before the real install-vs-installed UI settles —
    // waiting for that response avoids acting on the flash.
    const openObsidian = async () => {
      const cfg = page
        .waitForResponse(
          (r) => r.url().includes('/api/second-brain/obsidian') && r.request().method() === 'GET',
          { timeout: 20_000 },
        )
        .catch(() => null)
      await page.goto(`${baseURL}/second-brain`)
      await obsidianTab.click()
      await cfg
    }

    await openObsidian()

    // Either the InstallPanel (開始安裝) or the installed dashboard's 總覽 sub-tab
    // shows once config has settled.
    await expect(installBtn.or(overviewSubTab)).toBeVisible({ timeout: 20_000 })

    if (await installBtn.isVisible().catch(() => false)) {
      // Obsidian + CouchDB are pre-checked on a clean box.
      await installBtn.click(FORCE)
      await expect(page.getByText(installDone)).toBeVisible({ timeout: INSTALL_TIMEOUT })
    }

    // Verify installed: the dashboard defaults to the 關於 sub-tab; the uninstall
    // control lives on 總覽. Retry the whole navigate → switch → assert so a
    // late config-driven remount that resets the sub-tab can't flake the check.
    await expect(async () => {
      await openObsidian()
      await overviewSubTab.click({ timeout: 7_000 })
      await expect(uninstallBtn).toBeVisible({ timeout: 7_000 })
    }).toPass({ timeout: 120_000 })
  })
})
