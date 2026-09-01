import { describe, it, expect } from 'vitest'
import {
  shouldLoadExtensionViaCdp,
  buildOpencliLoaderScript,
} from '@/lib/browser/opencli-extension'
import { renderAppUnit } from '@/lib/headless-vnc/unit-templates'

// The opencli extension is installed to ~/.opencli/extension but never loaded on
// a normal install. buildChromeCommand only passes --load-extension when the
// binary name contains "chromium", and the installer installs Google Chrome —
// where that flag no longer works at all. So the extension sat on disk and the
// user had to load it by hand from chrome://extensions.
//
// Verified on a throwaway VPS (Google Chrome 152, 2026-09-01): the CDP command
// Extensions.loadUnpacked DOES work there — it returned an extension id and the
// extension's service worker came up — with no relaunch and no extra flag,
// because the browser already runs with --remote-debugging-port.
//
// It does NOT persist: after `systemctl --user restart chrome-headless` the
// extension was gone from /json/list, from Default/Preferences and from
// Default/Secure Preferences. So the load has to be re-issued on EVERY Chrome
// start, which is why it hangs off the unit's ExecStartPost rather than off an
// install-time step.

describe('shouldLoadExtensionViaCdp', () => {
  it('is needed on Google Chrome, where --load-extension does nothing', () => {
    expect(shouldLoadExtensionViaCdp('/usr/bin/google-chrome', true)).toBe(true)
  })

  // Chromium already gets the extension through --load-extension at launch;
  // loading it again over CDP would register a second copy.
  it('is not needed on Chromium, which takes the launch flag', () => {
    expect(shouldLoadExtensionViaCdp('/usr/bin/chromium-browser', true)).toBe(false)
    expect(shouldLoadExtensionViaCdp('/snap/bin/chromium', true)).toBe(false)
  })

  it('is skipped when the extension is not installed', () => {
    expect(shouldLoadExtensionViaCdp('/usr/bin/google-chrome', false)).toBe(false)
  })

  it('matches the binary case-insensitively', () => {
    expect(shouldLoadExtensionViaCdp('/opt/Chromium/CHROMIUM', true)).toBe(false)
  })
})

describe('buildOpencliLoaderScript', () => {
  const script = buildOpencliLoaderScript(9333, '/home/u/.opencli/extension')

  it('targets the configured CDP port and extension directory', () => {
    expect(script).toContain('127.0.0.1:9333')
    expect(script).toContain(JSON.stringify('/home/u/.opencli/extension'))
    expect(script).toContain('Extensions.loadUnpacked')
  })

  // Chrome's CDP endpoint is not up the instant ExecStart returns, so the
  // loader has to wait for it rather than fire once and miss.
  it('waits for the CDP endpoint instead of assuming it is ready', () => {
    expect(script).toContain('/json/version')
    expect(/for\s*\(|while\s*\(/.test(script)).toBe(true)
  })

  // ExecStartPost failure marks the whole unit failed. A browser that starts
  // fine must not be reported as broken just because the extension did not
  // load, so the loader always exits 0.
  it('never fails the unit', () => {
    expect(script).toContain('process.exit(0)')
    expect(script).not.toContain('process.exit(1)')
  })

  it('escapes the extension path rather than interpolating it raw', () => {
    const nasty = buildOpencliLoaderScript(9222, "/home/u/o'dd\"dir")
    expect(nasty).toContain(JSON.stringify("/home/u/o'dd\"dir"))
  })
})

describe('renderAppUnit', () => {
  const base = {
    prefix: 'chrome',
    display: ':99',
    resolution: '1920x1080',
    vncPort: 5901,
    websockifyPort: 6080,
    vncPasswordFile: '/home/u/.vnc/passwd',
    appCommand: '/usr/bin/google-chrome --foo',
    appDescription: 'Headless Chrome browser',
  }

  it('emits ExecStartPost when a post-start command is configured', () => {
    const unit = renderAppUnit({ ...base, appPostStart: '/usr/bin/node /home/u/load.mjs' })
    expect(unit).toContain('ExecStartPost=/usr/bin/node /home/u/load.mjs')
    // ExecStart must still come first.
    expect(unit.indexOf('ExecStart=')).toBeLessThan(unit.indexOf('ExecStartPost='))
  })

  it('omits ExecStartPost entirely when there is nothing to run', () => {
    expect(renderAppUnit(base)).not.toContain('ExecStartPost')
  })
})
