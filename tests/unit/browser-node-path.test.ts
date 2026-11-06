import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    exec: guard('exec'), execSync: guard('execSync'), execFile: guard('execFile'),
    spawn: guard('spawn'), spawnSync: guard('spawnSync'), fork: guard('fork'),
  }
  return { unexpected, guard, mod }
})
vi.mock('child_process', () => ({ ...m.mod, default: m.mod }))
vi.mock('node:child_process', () => ({ ...m.mod, default: m.mod }))

import { isExecutableFile, nodePathCandidates, resolveNodePath } from '@/lib/browser/node-path'

beforeEach(() => {
  m.unexpected.length = 0
  m.mod.execFileSync.mockReset().mockImplementation(m.guard('execFileSync'))
})
afterEach(() => {
  expect(m.unexpected).toEqual([])
})

describe('nodePathCandidates (pure mapping)', () => {
  it.each([
    ['/home/linuxbrew/.linuxbrew', 'node', '26.5.0'],
    ['/opt/homebrew', 'node', '26.12.1'],
    ['/usr/local', 'node@22', '22.20.0'],
    ['/custom/brew', 'node@24', '24.22.1_1'],
  ])('maps %s/Cellar/%s/%s to stable paths', (prefix, formula, version) => {
    expect(nodePathCandidates(`${prefix}/Cellar/${formula}/${version}/bin/node`)).toEqual([
      `${prefix}/opt/${formula}/bin/node`,
      `${prefix}/bin/node`,
    ])
  })

  it.each([
    '/usr/bin/node', '/usr/local/bin/node', '/home/u/.npm-global/bin/node',
    '/home/u/.nvm/versions/node/v26.5.0/bin/node', '/opt/homebrew/opt/node@22/bin/node',
    '/opt/Cellar/something-else/26.5.0/bin/node',
  ])('preserves %s', (node) => {
    expect(nodePathCandidates(node)).toEqual([node])
  })
})

describe('resolveNodePath', () => {
  let dir: string
  let cellar: string
  let opt: string
  let bin: string

  function executable(file: string): void {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '')
    chmodSync(file, 0o755)
  }

  function allowProbes(results: Record<string, boolean>): void {
    m.mod.execFileSync.mockImplementation((cmd, args, options) => {
      if (!(cmd in results) || JSON.stringify(args) !== JSON.stringify(['--version'])) {
        return m.guard('execFileSync')(cmd, args)
      }
      expect(options).toEqual({ timeout: 5000, stdio: 'pipe' })
      if (!results[cmd]) throw new Error('error while loading shared libraries: libada.so.3')
      return Buffer.from('v26.12.1\n')
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mcc-node-path-'))
    cellar = path.join(dir, 'Cellar/node/26.5.0/bin/node')
    opt = path.join(dir, 'opt/node/bin/node')
    bin = path.join(dir, 'bin/node')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the stable symlink even when it resolves into the Cellar', () => {
    executable(cellar)
    mkdirSync(path.dirname(opt), { recursive: true })
    symlinkSync(cellar, opt)
    allowProbes({ [opt]: true })
    expect(resolveNodePath(cellar)).toBe(opt)
  })

  it.each(['missing', 'not executable', 'directory', 'shared library failure'])('skips a candidate with %s', (kind) => {
    if (kind === 'directory') mkdirSync(opt, { recursive: true })
    if (kind === 'not executable' || kind === 'shared library failure') executable(opt)
    if (kind === 'not executable') chmodSync(opt, 0o644)
    executable(bin)
    allowProbes({ [opt]: false, [bin]: true })
    expect(resolveNodePath(cellar)).toBe(bin)
    expect(m.mod.execFileSync.mock.calls.map(([cmd]) => cmd)).not.toContain(cellar)
  })

  it('never falls back to the versioned path, even when that binary still runs', () => {
    executable(cellar)
    expect(isExecutableFile(cellar)).toBe(true)
    expect(() => resolveNodePath(cellar)).toThrow('No runnable stable Node interpreter')
    expect(m.mod.execFileSync).not.toHaveBeenCalled()
  })

  it('retains a working non-Homebrew path', () => {
    const nvm = path.join(dir, '.nvm/versions/node/v26.5.0/bin/node')
    executable(nvm)
    allowProbes({ [nvm]: true })
    expect(resolveNodePath(nvm)).toBe(nvm)
  })
})
