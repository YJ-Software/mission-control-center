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

// The install button disables itself the moment it's clicked (isInstalling) and
// stays disabled for the whole slow install; plain click() would time out
// re-checking actionability, so force the click to dispatch once.
const FORCE = { force: true } as const

test.describe('Second Brain — Obsidian setup', () => {
  test('install → verify', async ({ loggedInPage: page, baseURL }) => {
    // A full Obsidian + CouchDB install blows past the 10-min global timeout.
    test.setTimeout(25 * 60 * 1000)

    await page.goto(`${baseURL}/second-brain`)
    // Obsidian is the default tab; clicking is a no-op but makes intent explicit.
    await page.getByRole('tab', { name: 'Obsidian' }).click()

    const installBtn = page.getByRole('button', { name: installBtnName })
    const uninstallBtn = page.getByRole('button', { name: uninstallBtnName })

    // Either the InstallPanel (開始安裝) or the installed dashboard (解除安裝全部) shows.
    await expect(installBtn.or(uninstallBtn)).toBeVisible({ timeout: 20_000 })

    if (await installBtn.isVisible().catch(() => false)) {
      // Obsidian + CouchDB are pre-checked on a clean box.
      await installBtn.click(FORCE)
      await expect(page.getByText(installDone)).toBeVisible({ timeout: INSTALL_TIMEOUT })
    }

    // Verify installed: reload and confirm the dashboard exposes the uninstall
    // control (only rendered once obsidian + couchdb are installed).
    await page.goto(`${baseURL}/second-brain`)
    await page.getByRole('tab', { name: 'Obsidian' }).click()
    await expect(uninstallBtn).toBeVisible({ timeout: 30_000 })
  })
})
