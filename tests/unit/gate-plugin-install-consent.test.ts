import { describe, expect, it, vi, beforeEach } from 'vitest'

// MCC installs the two bundled CS plugins from a local path inside the repo
// (deploy/plugins/...) when the operator clicks Install in the dashboard.
// OpenClaw 2026.8.2 added two gates to that path, and MCC passed neither:
//
//   1. Local-path trust: "This source is outside ClawHub review and trust
//      metadata. ... Install cancelled; rerun with --force after reviewing."
//   2. Capability consent: "Plugin "X" requires capability consent. Use
//      openclaw plugins install or openclaw plugins enable with
//      --accept-capabilities, then retry."
//
// Verified on 2026-09-02 against a throwaway plugin declaring an EMPTY
// configSchema and no hooks: it was still refused. So "our plugin requests no
// capabilities" does not exempt it — the consent RECORD has to exist. Without
// these flags a fresh deployment cannot install the gate plugin at all, which
// silently takes out the cs-event mirror and outbound-filter shadow mode.

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/server-env', () => ({ getServerEnv: () => ({}) }))

/** Record every argv openclaw is invoked with; optionally fail some of them. */
function captureCalls(fail?: (args: string[]) => string | undefined) {
  const calls: string[][] = []
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
    calls.push(args)
    const failure = fail?.(args)
    if (failure) {
      const err: any = new Error(failure)
      err.stderr = failure
      cb(err, '', failure)
    } else {
      cb(null, 'ok', '')
    }
  })
  return calls
}

beforeEach(() => {
  execFileMock.mockReset()
})

describe('bundled CS plugin install passes the 2026.8.2 trust gates', () => {
  it('sends --force and --accept-capabilities on every local-path install', async () => {
    const calls = captureCalls()
    const { installPlugin } = await import('@/lib/customer-service/business-hours-gate')
    await installPlugin()

    const installs = calls.filter(a => a[0] === 'plugins' && a[1] === 'install')
    expect(installs.length).toBeGreaterThan(0)
    for (const argv of installs) {
      expect(argv, `install missing trust flags: ${argv.join(' ')}`).toContain('--force')
      expect(argv, `install missing consent: ${argv.join(' ')}`).toContain('--accept-capabilities')
    }
  })

  it('sends --accept-capabilities on every enable', async () => {
    const calls = captureCalls()
    const { installPlugin } = await import('@/lib/customer-service/business-hours-gate')
    await installPlugin()

    const enables = calls.filter(a => a[0] === 'plugins' && a[1] === 'enable')
    expect(enables.length).toBeGreaterThan(0)
    for (const argv of enables) {
      expect(argv, `enable missing consent: ${argv.join(' ')}`).toContain('--accept-capabilities')
    }
  })

  it('covers both bundled plugins, not just the gate', async () => {
    const calls = captureCalls()
    const { installPlugin } = await import('@/lib/customer-service/business-hours-gate')
    await installPlugin()

    const flat = calls.map(a => a.join(' ')).join('\n')
    expect(flat).toMatch(/openclaw-business-hours-gate/)
    expect(flat).toMatch(/openclaw-customer-id-injector/)
  })

  it('retries bare when an older OpenClaw rejects the unknown flags', async () => {
    // Older builds exit non-zero on an unrecognised option. Passing the flags
    // unconditionally must not break installs against those.
    const calls = captureCalls(args =>
      args.includes('--accept-capabilities') ? "error: unknown option '--accept-capabilities'" : undefined,
    )
    const { installPlugin } = await import('@/lib/customer-service/business-hours-gate')
    await installPlugin()

    const gateInstalls = calls.filter(
      a => a[0] === 'plugins' && a[1] === 'install' && a.join(' ').includes('business-hours-gate'),
    )
    // One attempt with flags, one without.
    expect(gateInstalls.length).toBe(2)
    expect(gateInstalls[0]).toContain('--accept-capabilities')
    expect(gateInstalls[1]).not.toContain('--accept-capabilities')
    expect(gateInstalls[1]).not.toContain('--force')
  })

  it('does not swallow a real install failure as if it were a flag problem', async () => {
    captureCalls(args =>
      args[0] === 'plugins' && args[1] === 'install' ? 'ENOSPC: no space left on device' : undefined,
    )
    const { installPlugin } = await import('@/lib/customer-service/business-hours-gate')
    await expect(installPlugin()).rejects.toThrow(/ENOSPC/)
  })
})
