/**
 * WHMCS refuses '新增部署' while any deploy row is still 執行中, even when the
 * deploy finished server-side long ago. A row only flips out of 執行中 once
 * someone loads its deploying.php page — that visit is what acks the deploy.
 *
 * The ack does not propagate across Playwright browser contexts, so every spec
 * that wants to trigger a deploy has to clear leftovers in its OWN context
 * first. Without this, a stale 執行中 row (e.g. left behind by a previous
 * release run) blocks '新增部署' forever: the deploy form never renders and the
 * spec fails downstream on a confusing locator timeout instead of the real
 * cause.
 *
 * Call this while sitting on the deploy-list page, before clicking 新增部署.
 */
export async function ackLeftoverDeploys(page, { maxAttempts = 5 } = {}) {
  const deployListUrl = page.url()
  let acked = 0

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const hrefs = await page.locator('tr[data-href*="deploying.php"]').evaluateAll(
      (rows) => rows
        .map((r) => r.getAttribute('data-href'))
        .filter((h) => !!h),
    )
    if (hrefs.length === 0) return acked

    for (const href of hrefs) {
      await page.goto(new URL(href, deployListUrl).href)
      acked++
    }
    await page.goto(deployListUrl)
  }

  // Still blocked after maxAttempts — surface it now rather than letting the
  // caller time out on a form that will never appear.
  const remaining = await page.locator('tr[data-href*="deploying.php"]').count()
  if (remaining > 0) {
    throw new Error(
      `WHMCS still reports ${remaining} deploy(s) 執行中 after ${maxAttempts} ack attempts — ` +
      `'新增部署' will be refused. Check the deploy list manually: ${deployListUrl}`,
    )
  }
  return acked
}
