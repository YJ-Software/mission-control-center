import { describe, it, expect } from 'vitest'
import { resolveBrowserView } from '../../src/components/browser/view-state'

// BrowserDashboard decided install-vs-dashboard straight off the react-query
// data. Before that query resolves `config` is undefined, so `installed` and
// `chromeServiceRunning` both read false and the INSTALL panel rendered — on
// every visit, including boxes where the browser is already installed. Users
// saw the installer flash before the dashboard replaced it.
//
// It also made browser-install.spec.ts flaky: the spec normalises the starting
// state with `installBtn.or(uninstallBtn)`, which matched the flash, decided
// "not installed", and then failed 10s later when the real state swapped the
// install button away. Seen for real in the 2026.8.2-v0.3.84 release run:
// failed in the suite, passed alone.
//
// The fix is a third state — nothing is decided until the config has loaded.

describe('resolveBrowserView', () => {
  const loaded = { loaded: true, forceView: null } as const

  it('waits instead of guessing while the config is still loading', () => {
    expect(
      resolveBrowserView({ loaded: false, installed: false, chromeServiceRunning: false, forceView: null }),
    ).toBe('loading')
  })

  it('shows the installer once loaded and genuinely not installed', () => {
    expect(
      resolveBrowserView({ ...loaded, installed: false, chromeServiceRunning: false }),
    ).toBe('install')
  })

  it('shows the dashboard when installed', () => {
    expect(resolveBrowserView({ ...loaded, installed: true, chromeServiceRunning: false })).toBe(
      'dashboard',
    )
  })

  // Chrome's services running counts as set up even when the stored flag says
  // otherwise — preserved from the original condition.
  it('shows the dashboard when the chrome service is running', () => {
    expect(resolveBrowserView({ ...loaded, installed: false, chromeServiceRunning: true })).toBe(
      'dashboard',
    )
  })

  // forceView is set by an explicit user action (uninstall just finished, or
  // is starting) and must win immediately — including before the refetch that
  // follows it has come back, which is exactly when `loaded` may be false.
  it('honours forceView=install over everything, even while loading', () => {
    expect(
      resolveBrowserView({ loaded: false, installed: true, chromeServiceRunning: true, forceView: 'install' }),
    ).toBe('install')
  })

  it('honours forceView=dashboard over the not-installed condition', () => {
    expect(
      resolveBrowserView({ loaded: true, installed: false, chromeServiceRunning: false, forceView: 'dashboard' }),
    ).toBe('dashboard')
  })

  it('honours forceView=dashboard while loading', () => {
    expect(
      resolveBrowserView({ loaded: false, installed: false, chromeServiceRunning: false, forceView: 'dashboard' }),
    ).toBe('dashboard')
  })

  // The regression in one line: an installed box must never render the
  // installer, not even for a frame.
  it('never shows the installer for an installed box at any point in the load', () => {
    for (const isLoaded of [false, true]) {
      const view = resolveBrowserView({
        loaded: isLoaded,
        installed: true,
        chromeServiceRunning: true,
        forceView: null,
      })
      expect(view).not.toBe('install')
    }
  })
})
