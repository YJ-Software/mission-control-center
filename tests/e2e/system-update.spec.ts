import { test, expect } from './fixtures/login'

/**
 * Header OS-update detection. The throwaway is a long-lived Ubuntu box that
 * accumulates pending packages and a reboot flag, so both badges have something
 * real to render. Detection comes from update-notifier's apt-check, which
 * prints "<updates>;<security>" to stderr — reading stdout returns an empty
 * string and would render "no updates" on a box with dozens pending.
 */
test('header shows the OS update badge and the reboot button', async ({
  loggedInPage: page, baseURL,
}) => {
  const res = await page.request.get(`${baseURL}/api/upgrade/system-check`)
  expect(res.ok()).toBe(true)
  const sys = await res.json()

  // Only assert on the UI for states this box is actually in.
  test.skip(sys.manager !== 'apt', 'host has no apt-check')

  await page.goto(`${baseURL}/dashboard`)

  if (sys.updates > 0) {
    await expect(
      page.getByRole('button', { name: /系統更新|system updates|系统更新/i }),
    ).toBeVisible({ timeout: 30_000 })
  }

  if (sys.rebootRequired) {
    await expect(
      page.getByRole('button', { name: /需要重新開機|Reboot required|需要重新启动/i }),
    ).toBeVisible({ timeout: 30_000 })
  }
})
