import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const m = vi.hoisted(() => {
  const unexpected: string[] = []
  const guard = (name: string) => (...args: unknown[]) => {
    unexpected.push(`${name} ${String(args[0])}`)
    throw new Error(`unmocked child_process.${name}`)
  }
  const mod = {
    execFileSync: vi.fn<(cmd: string, args: string[], options?: unknown) => unknown>(guard('execFileSync')),
    spawn: vi.fn<(cmd: string, args: string[], options?: unknown) => unknown>(guard('spawn')),
    exec: guard('exec'), execSync: guard('execSync'), execFile: guard('execFile'),
    spawnSync: guard('spawnSync'), fork: guard('fork'),
  }
  return { unexpected, guard, mod, home: '', chrome: '/usr/bin/google-chrome', notify: vi.fn() }
})
vi.mock('child_process', () => ({ ...m.mod, default: m.mod }))
vi.mock('node:child_process', () => ({ ...m.mod, default: m.mod }))
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>()
  const mod = { ...actual, homedir: () => m.home }
  return { ...mod, default: mod }
})
vi.mock('@/lib/browser/config', () => ({
  getChromeBinaryPath: () => m.chrome,
  getBrowserConfig: () => '9333',
}))
vi.mock('@/lib/notifications', () => ({ createNotification: m.notify }))

import {
  buildAutoloadDropIn,
  decideAutoloadRepair,
  ensureOpencliAutoload,
  getAutoloadDropInPath,
  isAutoloadConfigured,
  loaderNeedsRepair,
  postStartCommands,
  unitRunsLoader,
} from '@/lib/browser/opencli-autoload-repair'
import { buildOpencliLoaderScript } from '@/lib/browser/opencli-extension'

// A browser stack installed before 0.3.82 has a Chrome unit with no
// ExecStartPost, and upgrade.sh only re-renders Mission Control's own unit — so
// those boxes never regain the extension after a Chrome restart, and every
// opencli browser command fails with BROWSER_CONNECT while the UI looks fine.

const LOADER = '/home/u/.config/mission-control/load-opencli-extension.mjs'

beforeEach(() => {
  m.unexpected.length = 0
  m.mod.execFileSync.mockReset().mockImplementation(m.guard('execFileSync'))
  m.mod.spawn.mockReset().mockImplementation(m.guard('spawn'))
})
afterEach(() => {
  expect(m.unexpected).toEqual([])
})

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

  it('repairs an existing unsafe loader', () => {
    expect(decideAutoloadRepair({ unitExists: true, runsLoader: true, loaderNeedsRepair: true, chromeBin: chrome, extensionInstalled: true })).toBe('repair')
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
    expect(conf).toContain(`ExecStartPost=\nExecStartPost=-/usr/bin/node ${LOADER}`)
    expect(conf).not.toContain('ExecStart=')
    expect(conf).not.toMatch(/rfbport|websockify|vnc_port/i)
  })
})

describe('loaderNeedsRepair', () => {
  it.each([
    ['missing', [], true],
    ['versioned Cellar', [`-/home/linuxbrew/.linuxbrew/Cellar/node/26.5.0/bin/node ${LOADER}`], true],
    ['versioned node@NN', [`-/opt/homebrew/Cellar/node@22/22.20.0/bin/node ${LOADER}`], true],
    ['missing ignore-failure', [`/usr/bin/node ${LOADER}`], true],
    ['stable and executable', [`-/usr/bin/node ${LOADER}`], false],
    ['quoted interpreter', [`-"/usr/bin/node" "${LOADER}"`], false],
    ['loader path only mentioned in another command', [`/usr/bin/echo ${LOADER}.backup`], true],
  ])('%s', (_label, commands, expected) => {
    expect(loaderNeedsRepair(commands, LOADER, () => true)).toBe(expected)
  })

  it('detects a non-executable interpreter even with ignore-failure', () => {
    expect(loaderNeedsRepair([`-/missing/node ${LOADER}`], LOADER, () => false)).toBe(true)
  })

  it('honors list resets and replaces all obsolete loader invocations', () => {
    const unit = `[Service]\nExecStartPost=/old/node ${LOADER}\nExecStartPost=/usr/bin/echo keep`
    const dropIn = buildAutoloadDropIn('/usr/bin/node', LOADER, postStartCommands([unit]))
    const commands = postStartCommands([unit, dropIn])
    expect(commands).toEqual(['/usr/bin/echo keep', `-/usr/bin/node ${LOADER}`])
    expect(loaderNeedsRepair(commands, LOADER, () => true)).toBe(false)
    expect(buildAutoloadDropIn('/usr/bin/node', LOADER, commands)).toBe(dropIn)
  })
})

describe('startup repair (temporary home, no real processes)', () => {
  let home: string
  let unitPath: string
  let loader: string
  let node: string
  let reloads: number

  function file(filePath: string, text = '', mode = 0o644): string {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, text)
    chmodSync(filePath, mode)
    return filePath
  }

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'mcc-autoload-repair-'))
    m.home = home
    m.chrome = '/usr/bin/google-chrome'
    unitPath = path.join(home, '.config/systemd/user/chrome-headless.service')
    loader = path.join(home, '.config/mission-control/load-opencli-extension.mjs')
    node = file(path.join(home, 'brew/opt/node/bin/node'), '', 0o755)
    file(path.join(home, '.opencli/extension/manifest.json'), '{}')
    reloads = 0
    m.mod.execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && JSON.stringify(args) === JSON.stringify(['--user', 'daemon-reload'])) {
        reloads++
        return Buffer.from('')
      }
      if (cmd === node && JSON.stringify(args) === JSON.stringify(['--version'])) return Buffer.from('v26.12.1')
      return m.guard('execFileSync')(cmd, args)
    })
    m.mod.spawn.mockImplementation((cmd, args, options) => {
      if (cmd !== node || JSON.stringify(args) !== JSON.stringify([loader])) return m.guard('spawn')(cmd, args)
      expect(options).toEqual({ stdio: 'inherit', detached: true })
      return { on: vi.fn(), unref: vi.fn() }
    })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it.each(['base unit', 'existing managed drop-in'])('repairs a pinned %s once without restarting Chrome', (location) => {
    const oldNode = path.join(home, 'brew/Cellar/node/26.5.0/bin/node')
    // The original binary can still be executable; pinning alone is unsafe.
    file(oldNode, '', 0o755)
    const oldLoader = `ExecStartPost=${oldNode} ${loader}`
    const unit = `[Service]\nExecStart=/usr/bin/google-chrome --remote-debugging-port=9333\nExecStartPost=/usr/bin/echo keep\n${location === 'base unit' ? oldLoader : ''}\nRestart=on-failure\nRestartSec=10\n`
    file(unitPath, unit)
    if (location === 'existing managed drop-in') file(getAutoloadDropInPath(), `[Service]\n${oldLoader}\n`)

    expect(isAutoloadConfigured()).toBe(false)
    expect(ensureOpencliAutoload()).toBe('repair')
    const dropIn = readFileSync(getAutoloadDropInPath(), 'utf8')
    const writtenAt = statSync(getAutoloadDropInPath()).mtimeMs
    expect(postStartCommands([unit, dropIn])).toEqual(['/usr/bin/echo keep', `-${node} ${loader}`])
    expect(dropIn).not.toContain(oldNode)
    expect(readFileSync(unitPath, 'utf8')).toBe(unit)
    expect(readFileSync(loader, 'utf8')).toContain('127.0.0.1:9333')
    expect(readFileSync(loader, 'utf8')).toContain("console.log('[opencli-extension] '")
    expect(reloads).toBe(1)

    expect(isAutoloadConfigured()).toBe(true)
    // The startup loader also runs on an already configured box.
    const execDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!
    Object.defineProperty(process, 'execPath', { ...execDescriptor, value: node })
    try {
      expect(ensureOpencliAutoload()).toBe('configured')
    } finally {
      Object.defineProperty(process, 'execPath', execDescriptor)
    }
    expect(readFileSync(getAutoloadDropInPath(), 'utf8')).toBe(dropIn)
    expect(statSync(getAutoloadDropInPath()).mtimeMs).toBe(writtenAt)
    expect(reloads).toBe(1)
    expect(m.mod.spawn).toHaveBeenCalledTimes(2)
  })

  it.each(['missing', 'not executable', 'directory'])('replaces a %s interpreter with the current stable runtime', (kind) => {
    const broken = path.join(home, 'broken/node')
    if (kind === 'not executable') file(broken, '', 0o644)
    if (kind === 'directory') mkdirSync(broken, { recursive: true })
    file(unitPath, `[Service]\nExecStartPost=-${broken} ${loader}\n`)
    const execDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!
    Object.defineProperty(process, 'execPath', { ...execDescriptor, value: node })
    try {
      expect(ensureOpencliAutoload()).toBe('repair')
    } finally {
      Object.defineProperty(process, 'execPath', execDescriptor)
    }
    expect(readFileSync(getAutoloadDropInPath(), 'utf8')).toContain(`ExecStartPost=-${node} ${loader}`)
    expect(reloads).toBe(1)
  })

  it.each(['missing loader', 'missing ignore-failure'])('repairs %s and preserves earlier operator hooks', (kind) => {
    file(unitPath, `[Service]\nExecStart=/usr/bin/google-chrome\n${kind === 'missing ignore-failure' ? `ExecStartPost=${node} ${loader}\n` : ''}`)
    const operatorDropIn = path.join(path.dirname(getAutoloadDropInPath()), '00-operator.conf')
    const operatorText = '[Service]\nExecStartPost=/usr/bin/echo keep\n'
    file(operatorDropIn, operatorText)
    const execDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!
    Object.defineProperty(process, 'execPath', { ...execDescriptor, value: node })
    try {
      expect(ensureOpencliAutoload()).toBe('repair')
      expect(ensureOpencliAutoload()).toBe('configured')
    } finally {
      Object.defineProperty(process, 'execPath', execDescriptor)
    }
    const dropIn = readFileSync(getAutoloadDropInPath(), 'utf8')
    expect(postStartCommands([readFileSync(unitPath, 'utf8'), operatorText, dropIn]))
      .toEqual(['/usr/bin/echo keep', `-${node} ${loader}`])
    expect(readFileSync(operatorDropIn, 'utf8')).toBe(operatorText)
    expect(reloads).toBe(1)
  })

  it('leaves the existing unit intact when no stable interpreter can run', () => {
    const oldNode = path.join(home, 'unlinked-brew/Cellar/node/26.5.0/bin/node')
    const unit = `[Service]\nExecStartPost=${oldNode} ${loader}\n`
    file(unitPath, unit)
    const execDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!
    Object.defineProperty(process, 'execPath', { ...execDescriptor, value: path.join(home, 'missing-current-node') })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(ensureOpencliAutoload()).toBe('repair')
    } finally {
      Object.defineProperty(process, 'execPath', execDescriptor)
    }
    expect(warning).toHaveBeenCalledWith('[opencli-autoload] check failed:', expect.stringContaining('No runnable stable Node interpreter'))
    expect(readFileSync(unitPath, 'utf8')).toBe(unit)
    expect(existsSync(getAutoloadDropInPath())).toBe(false)
    expect(m.mod.execFileSync).not.toHaveBeenCalled()
    expect(m.mod.spawn).not.toHaveBeenCalled()
  })

  it('does nothing without a browser unit or with Chromium', () => {
    expect(ensureOpencliAutoload()).toBe('no-browser')
    file(unitPath, '[Service]\nExecStart=/usr/bin/chromium\n')
    m.chrome = '/usr/bin/chromium'
    expect(ensureOpencliAutoload()).toBe('not-applicable')
    expect(existsSync(getAutoloadDropInPath())).toBe(false)
    expect(m.mod.execFileSync).not.toHaveBeenCalled()
    expect(m.mod.spawn).not.toHaveBeenCalled()
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
