import type { Page } from '@playwright/test'

/**
 * Visit every leftover 執行中 deploy row's deploying.php page so WHMCS stops
 * refusing 新增部署. Must be called while on the deploy-list page.
 * Returns the number of rows acked. Throws if rows remain after maxAttempts.
 */
export function ackLeftoverDeploys(
  page: Page,
  opts?: { maxAttempts?: number },
): Promise<number>
