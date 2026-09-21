import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { ensureServiceUnit } from '@/lib/upgrade/ensure-service-unit'
import { renderServiceUnit } from '@/lib/upgrade/service-unit'

const PREFIX = '/home/u/mission-control'
const STATE = '/home/u/.mission-control'
const HOME = '/home/u'
const SERVICE = 'mission-control'
const TMPL_PATH = path.join(PREFIX, 'current', 'install', 'mission-control.service.tmpl')
const UNIT_PATH = path.join(HOME, '.config/systemd/user', 'mission-control.service')

const TMPL = [
  '[Unit]',
  'Description=Mission Control Center',
  '',
  '[Service]',
  'WorkingDirectory=__PREFIX__/current',
  'ExecStart=__NODE_BIN__ __PREFIX__/current/server.js',
  'EnvironmentFile=__STATE__/.env.local',
  'Environment=PATH=__NODE_DIR__:/usr/bin',
  '',
].join('\n')

/** In-memory fs seeded with the files each test needs. `realpaths` seeds a
 * small symlink map for realpathSync: path -> its canonical target. Any path
 * not in the map resolves to itself. */
function fakeFs(seed: Record<string, string>, realpaths: Record<string, string> = {}) {
  const files = { ...seed }
  const calls: string[] = []
  return {
    files,
    calls,
    api: {
      existsSync: (p: string) => p in files,
      readFileSync: (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT ${p}`)
        return files[p]
      },
      writeFileSync: (p: string, data: string) => { files[p] = data; calls.push(`write ${p}`) },
      renameSync: (a: string, b: string) => { files[b] = files[a]; delete files[a]; calls.push(`rename ${a} -> ${b}`) },
      copyFileSync: (a: string, b: string) => { files[b] = files[a]; calls.push(`copy ${a} -> ${b}`) },
      mkdirSync: (p: string) => { calls.push(`mkdir ${p}`) },
      realpathSync: (p: string) => { calls.push(`realpath ${p}`); return realpaths[p] ?? p },
      rmSync: (p: string) => { delete files[p]; calls.push(`rm ${p}`) },
    },
  }
}

const base = { mode: 'release' as const, prefix: PREFIX, state: STATE, service: SERVICE, home: HOME, nodeBin: '/usr/bin/node' }
// Same options but WITHOUT an explicit nodeBin, so ensureServiceUnit must derive it
// (from the existing unit's ExecStart, or fall back to process.execPath).
const baseAutoNode = { mode: 'release' as const, prefix: PREFIX, state: STATE, service: SERVICE, home: HOME }

describe('ensureServiceUnit', () => {
  it('writes the unit when the rendered template differs, then reloads', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '', [UNIT_PATH]: '[Service]\nExecStart=/usr/bin/node /old/server.js\n' })
    const run = vi.fn().mockResolvedValue(undefined)
    expect(await ensureServiceUnit({ ...base, fs: f.api, run })).toBe('updated')

    expect(f.files[UNIT_PATH]).toContain('ExecStart=/usr/bin/node /home/u/mission-control/current/server.js')
    expect(f.files[`${UNIT_PATH}.bak`]).toContain('/old/server.js')
    // Written to a temp path and renamed — never truncated in place.
    expect(f.calls.some(c => c.startsWith(`write ${UNIT_PATH}.tmp`))).toBe(true)
    expect(f.calls).toContain(`rename ${UNIT_PATH}.tmp -> ${UNIT_PATH}`)
    expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'])
  })

  it('never restarts the service — this code runs inside it', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
    const run = vi.fn().mockResolvedValue(undefined)
    await ensureServiceUnit({ ...base, fs: f.api, run })
    for (const [, args] of run.mock.calls) {
      expect((args as string[]).join(' ')).not.toMatch(/restart|stop|start/)
    }
  })

  it('does nothing when the unit already matches', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
    const run = vi.fn().mockResolvedValue(undefined)
    // First call writes it; second must be a no-op.
    await ensureServiceUnit({ ...base, fs: f.api, run })
    run.mockClear()
    const before = f.files[UNIT_PATH]
    expect(await ensureServiceUnit({ ...base, fs: f.api, run })).toBe('unchanged')
    expect(f.files[UNIT_PATH]).toBe(before)
  })

  it('refuses to write a unit that still has placeholders', async () => {
    // A template using an unknown placeholder renders incompletely.
    const bad = TMPL.replace('__STATE__', '__STATE_DIR__')
    const f = fakeFs({ [TMPL_PATH]: bad, '/usr/bin/node': '', [UNIT_PATH]: 'old' })
    const run = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await ensureServiceUnit({ ...base, fs: f.api, run })).toBe('rejected')
    expect(f.files[UNIT_PATH]).toBe('old')
    expect(run).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips when the version ships no template (older tarball)', async () => {
    const f = fakeFs({ '/usr/bin/node': '' })
    expect(await ensureServiceUnit({ ...base, fs: f.api, run: vi.fn() })).toBe('skipped-no-template')
  })

  it('skips when the node binary is missing', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL })
    expect(await ensureServiceUnit({ ...base, fs: f.api, run: vi.fn() })).toBe('skipped-no-node')
  })

  it('skips outside a release install', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
    expect(await ensureServiceUnit({ ...base, mode: 'dev', fs: f.api, run: vi.fn() })).toBe('skipped-not-release')
  })

  it('never throws when daemon-reload fails', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
    const run = vi.fn().mockRejectedValue(new Error('no user bus'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await ensureServiceUnit({ ...base, fs: f.api, run })).toBe('failed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('cleans up the leftover .tmp file when the write fails', async () => {
    const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
    // renameSync throws — simulate a rename failure (e.g. cross-device, permissions).
    f.api.renameSync = () => { throw new Error('EXDEV') }
    const run = vi.fn().mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await ensureServiceUnit({ ...base, fs: f.api, run })).toBe('failed')
    expect(f.files[`${UNIT_PATH}.tmp`]).toBeUndefined()
    warn.mockRestore()
  })

  // --- C1: never pin ExecStart to a resolved, version-specific node path ---
  describe('nodeBin resolution (no explicit opts.nodeBin)', () => {
    it('keeps the existing unit\'s node path when it resolves to the same node as process.execPath (unchanged)', async () => {
      const stableNodePath = '/home/u/.linuxbrew/bin/node'
      const current = renderServiceUnit(TMPL, { nodeBin: stableNodePath, state: STATE, prefix: PREFIX })
      const f = fakeFs(
        { [TMPL_PATH]: TMPL, [UNIT_PATH]: current, [stableNodePath]: '' },
        { [stableNodePath]: '/real/cellar/node/bin/node', [process.execPath]: '/real/cellar/node/bin/node' },
      )
      const run = vi.fn().mockResolvedValue({ stdout: 'no\n' })
      const result = await ensureServiceUnit({ ...baseAutoNode, fs: f.api, run })
      expect(result).toBe('unchanged')
      expect(f.calls.some(c => c.startsWith('write'))).toBe(false)
    })

    it('falls back to process.execPath when the unit\'s node path no longer exists on disk', async () => {
      const missingToken = '/home/u/.volta/bin/node'
      const current = ['[Service]', `ExecStart=${missingToken} ${PREFIX}/current/server.js`, ''].join('\n')
      const f = fakeFs({ [TMPL_PATH]: TMPL, [UNIT_PATH]: current, [process.execPath]: '' })
      const run = vi.fn().mockResolvedValue(undefined)
      const result = await ensureServiceUnit({ ...baseAutoNode, fs: f.api, run })
      expect(result).toBe('updated')
      expect(f.files[UNIT_PATH]).toContain(`ExecStart=${process.execPath} `)
    })

    it('falls back to process.execPath when the unit\'s node path resolves to a different node', async () => {
      const otherToken = '/home/u/.nvm/versions/node/v18/bin/node'
      const current = ['[Service]', `ExecStart=${otherToken} ${PREFIX}/current/server.js`, ''].join('\n')
      const f = fakeFs(
        { [TMPL_PATH]: TMPL, [UNIT_PATH]: current, [otherToken]: '', [process.execPath]: '' },
        { [otherToken]: '/real/nvm/v18/node', [process.execPath]: '/real/other/node' },
      )
      const run = vi.fn().mockResolvedValue(undefined)
      const result = await ensureServiceUnit({ ...baseAutoNode, fs: f.api, run })
      expect(result).toBe('updated')
      expect(f.files[UNIT_PATH]).toContain(`ExecStart=${process.execPath} `)
    })

    it('an explicit opts.nodeBin still wins over the existing unit\'s path', async () => {
      const stableNodePath = '/home/u/.linuxbrew/bin/node'
      const current = renderServiceUnit(TMPL, { nodeBin: stableNodePath, state: STATE, prefix: PREFIX })
      const f = fakeFs(
        { [TMPL_PATH]: TMPL, [UNIT_PATH]: current, [stableNodePath]: '', '/explicit/node': '' },
        { [stableNodePath]: '/real/cellar/node/bin/node', [process.execPath]: '/real/cellar/node/bin/node' },
      )
      const run = vi.fn().mockResolvedValue(undefined)
      const result = await ensureServiceUnit({ ...baseAutoNode, nodeBin: '/explicit/node', fs: f.api, run })
      expect(result).toBe('updated')
      expect(f.files[UNIT_PATH]).toContain('ExecStart=/explicit/node ')
    })
  })

  // --- I1: a failed daemon-reload must not be permanent ---
  describe('opportunistic daemon-reload on the unchanged path', () => {
    it('runs daemon-reload when systemd reports one is pending', async () => {
      const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
      // Seed a unit that already matches so the first call is a no-op write.
      await ensureServiceUnit({ ...base, fs: f.api, run: vi.fn().mockResolvedValue(undefined) })
      const run = vi.fn(async (_cmd: string, args: string[]) => (args.includes('show') ? { stdout: 'yes\n' } : undefined))
      const result = await ensureServiceUnit({ ...base, fs: f.api, run })
      expect(result).toBe('unchanged')
      expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'show', '-p', 'NeedDaemonReload', '--value', `${SERVICE}.service`])
      expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'])
    })

    it('does not run daemon-reload when systemd reports nothing pending', async () => {
      const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
      await ensureServiceUnit({ ...base, fs: f.api, run: vi.fn().mockResolvedValue(undefined) })
      const run = vi.fn(async (_cmd: string, args: string[]) => (args.includes('show') ? { stdout: 'no\n' } : undefined))
      const result = await ensureServiceUnit({ ...base, fs: f.api, run })
      expect(result).toBe('unchanged')
      expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'show', '-p', 'NeedDaemonReload', '--value', `${SERVICE}.service`])
      expect(run).not.toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'])
    })

    it('never throws when the NeedDaemonReload check itself fails', async () => {
      const f = fakeFs({ [TMPL_PATH]: TMPL, '/usr/bin/node': '' })
      await ensureServiceUnit({ ...base, fs: f.api, run: vi.fn().mockResolvedValue(undefined) })
      const run = vi.fn().mockRejectedValue(new Error('no user bus'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await ensureServiceUnit({ ...base, fs: f.api, run })
      expect(result).toBe('unchanged')
      warn.mockRestore()
    })
  })
})
