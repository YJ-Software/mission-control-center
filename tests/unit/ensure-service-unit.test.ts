import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { ensureServiceUnit } from '@/lib/upgrade/ensure-service-unit'

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

/** In-memory fs seeded with the files each test needs. */
function fakeFs(seed: Record<string, string>) {
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
    },
  }
}

const base = { mode: 'release' as const, prefix: PREFIX, state: STATE, service: SERVICE, home: HOME, nodeBin: '/usr/bin/node' }

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
    expect(run).not.toHaveBeenCalled()
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
})
