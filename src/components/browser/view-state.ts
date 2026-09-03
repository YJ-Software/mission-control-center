/** Which panel /browser should render.
 *
 * `loading` exists because the decision used to be made from react-query data
 * that had not arrived yet: with `config` still undefined both `installed` and
 * `chromeServiceRunning` read false, so the installer rendered on every visit
 * and was then replaced once the real state arrived. Users saw the installer
 * flash on an already-installed box, and browser-install.spec.ts latched onto
 * that flash and mis-decided the starting state.
 *
 * Kept as a pure function so the ordering is testable without a DOM. */
export type BrowserView = 'loading' | 'install' | 'dashboard'

export interface BrowserViewInput {
  /** Has the /api/browser query resolved at least once? */
  loaded: boolean
  installed: boolean
  chromeServiceRunning: boolean
  /** Set by an explicit user action (uninstall finished / starting). */
  forceView: 'dashboard' | 'install' | null
}

export function resolveBrowserView({
  loaded,
  installed,
  chromeServiceRunning,
  forceView,
}: BrowserViewInput): BrowserView {
  // An explicit user action wins outright — including over `loading`, because
  // it is set alongside a refetch and the panel must switch on the click, not
  // when the network catches up.
  if (forceView === 'install') return 'install'
  if (forceView === 'dashboard') return 'dashboard'

  if (!loaded) return 'loading'

  return !installed && !chromeServiceRunning ? 'install' : 'dashboard'
}
