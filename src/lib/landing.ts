/** Where a freshly-authenticated visitor lands.
 *
 * Customers reaching their VPS through the chat subdomain want a chat window,
 * not the operator dashboard; the operator wants the dashboard. One per-box
 * setting decides, so OCD can flip it at deploy without a separate build and
 * without changing anything for existing installs.
 */
export const LANDING_KEY = 'ui.landingPage'

export const CHAT_PATH = '/talk'
export const DASHBOARD_PATH = '/dashboard'

export type LandingMode = 'chat' | 'dashboard'

/** Defaults to the dashboard for anything unset or unrecognised: existing
 * installs have no such row and must not have their landing page moved by an
 * upgrade, and a typo must not strand someone on a blank page. */
export function resolveLandingPath(setting: string | null | undefined): string {
  return setting === 'chat' ? CHAT_PATH : DASHBOARD_PATH
}
