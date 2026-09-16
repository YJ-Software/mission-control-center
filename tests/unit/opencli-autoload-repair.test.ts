import { describe, expect, it } from 'vitest'
import {
  buildAutoloadDropIn,
  decideAutoloadRepair,
  unitRunsLoader,
} from '@/lib/browser/opencli-autoload-repair'
import { buildOpencliLoaderScript } from '@/lib/browser/opencli-extension'

// A browser stack installed before 0.3.82 has a Chrome unit with no
// ExecStartPost, and upgrade.sh only re-renders Mission Control's own unit — so
// those boxes never regain the extension after a Chrome restart, and every
// opencli browser command fails with BROWSER_CONNECT while the UI looks fine.

const LOADER = '/home/u/.config/mission-control/load-opencli-extension.mjs'

describe('unitRunsLoader', () => {
  it('sees the loader in a unit or drop-in', () => {
    expect(unitRunsLoader(`[Service]\nExecStart=/usr/bin/google-chrome\nExecStartPost=/usr/bin/node ${LOADER}\n`, LOADER)).toBe(true)
    expect(unitRunsLoader(`[Service]\nExecStartPost=${process.execPath} ${LOADER}`, LOADER)).toBe(true)
  })

  it('is false for a unit that only starts Chrome', () => {
    expect(unitRunsLoader('[Service]\nExecStart=/usr/bin/google-chrome --remote-debugging-port=9222\n', LOADER)).toBe(false)
    expect(unitRunsLoader(null, LOADER)).toBe(false)
    expect(unitRunsLoader(undefined, LOADER)).toBe(false)
  })

  it('does not count a mention that is not an ExecStartPost', () => {
    expect(unitRunsLoader(`# see ${LOADER} for details\n[Service]\nExecStart=/usr/bin/google-chrome`, LOADER)).toBe(false)
  })
})

describe('decideAutoloadRepair', () => {
  const chrome = '/usr/bin/google-chrome-stable'

  it('repairs a Google Chrome unit that never loads the extension', () => {
    expect(decideAutoloadRepair({ unitExists: true, runsLoader: false, chromeBin: chrome, extensionInstalled: true })).toBe('repair')
  })

  it('leaves a configured unit alone', () => {
    expect(decideAutoloadRepair({ unitExists: true, runsLoader: true, chromeBin: chrome, extensionInstalled: true })).toBe('configured')
  })

  it('does nothing when there is no browser stack', () => {
    expect(decideAutoloadRepair({ unitExists: false, runsLoader: false, chromeBin: chrome, extensionInstalled: true })).toBe('no-browser')
  })

  it('skips Chromium, which takes the extension at launch, and a missing extension', () => {
    expect(decideAutoloadRepair({ unitExists: true, runsLoader: false, chromeBin: '/usr/bin/chromium-browser', extensionInstalled: true })).toBe('not-applicable')
    expect(decideAutoloadRepair({ unitExists: true, runsLoader: false, chromeBin: chrome, extensionInstalled: false })).toBe('not-applicable')
  })
})

describe('buildAutoloadDropIn', () => {
  it('adds only an ExecStartPost, so the rest of the unit (ports included) is untouched', () => {
    const conf = buildAutoloadDropIn('/usr/bin/node', LOADER)
    expect(conf).toContain('[Service]')
    expect(conf).toContain(`ExecStartPost=/usr/bin/node ${LOADER}`)
    expect(conf).not.toContain('ExecStart=')
    expect(conf).not.toMatch(/rfbport|websockify|vnc_port/i)
  })
})

describe('loader idempotency', () => {
  // The drop-in and a later full reinstall can both carry an ExecStartPost, and
  // the boot repair runs it a third time; loading twice registers a duplicate.
  it('skips when an extension is already loaded', () => {
    const script = buildOpencliLoaderScript(9222, '/home/u/.opencli/extension')
    expect(script).toContain('/json/list')
    expect(script).toContain('chrome-extension://')
    expect(script).toContain('already loaded')
    expect(script).toContain('process.exit(0)')
    expect(script).not.toContain('process.exit(1)')
  })
})
