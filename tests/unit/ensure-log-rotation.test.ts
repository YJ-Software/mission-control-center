import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { ensureLogRotation } from '@/lib/upgrade/ensure-log-rotation'

const base = { prefix: '/p', state: '/s', service: 'mission-control' }
const script = path.join('/p', 'current', 'install', 'install-logrotate.sh')

/**
 * Why this runs at startup instead of inside the upgrade flow: both upgrade
 * paths execute the OLD version's code — the UI button runs the currently
 * running process's manager.ts, and upgrade.sh is invoked from the installed
 * tree. A step added there only takes effect one upgrade later. The new
 * version's first boot is the one place guaranteed to run the new code.
 */
describe('ensureLogRotation', () => {
  it('runs the installer shipped with the running version', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const r = await ensureLogRotation({ ...base, mode: 'release', exists: () => true, run })
    expect(r).toBe('ran')
    expect(run).toHaveBeenCalledWith('bash', [
      script,
      path.join('/p', 'current', 'install'),
      '/s',
      'mission-control',
    ])
  })

  it('does nothing outside a release install (dev box has its own journald unit)', async () => {
    const run = vi.fn()
    expect(await ensureLogRotation({ ...base, mode: 'dev', exists: () => true, run })).toBe('skipped-not-release')
    expect(await ensureLogRotation({ ...base, mode: 'unknown', exists: () => true, run })).toBe('skipped-not-release')
    expect(run).not.toHaveBeenCalled()
  })

  it('skips quietly when the tarball predates the installer', async () => {
    const run = vi.fn()
    const r = await ensureLogRotation({ ...base, mode: 'release', exists: () => false, run })
    expect(r).toBe('skipped-no-script')
    expect(run).not.toHaveBeenCalled()
  })

  it('never throws — a failed rotation setup must not take the dashboard down', async () => {
    const run = vi.fn().mockRejectedValue(new Error('systemctl: no user bus'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await ensureLogRotation({ ...base, mode: 'release', exists: () => true, run })
    expect(r).toBe('failed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
