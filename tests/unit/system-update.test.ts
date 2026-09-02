import { describe, expect, it } from 'vitest'
import {
  parseAptCheck,
  parseRebootPackages,
  buildSystemUpdatePhases,
  buildRebootCommand,
} from '@/lib/system-update/apt'

// Verified on the throwaway (Ubuntu 24.04):
//   /usr/lib/update-notifier/apt-check  → "51;0" on STDERR, stdout empty
//   /var/run/reboot-required            → present after a kernel/libc upgrade
//   /var/run/reboot-required.pkgs       → one package name per line
// The stderr detail is the trap: reading stdout gets an empty string and the
// dashboard would report "no updates" on a box with 51 pending.

describe('parseAptCheck', () => {
  it('parses the updates;security pair', () => {
    expect(parseAptCheck('51;0')).toEqual({ updates: 51, security: 0 })
  })

  it('parses a security count', () => {
    expect(parseAptCheck('12;5')).toEqual({ updates: 12, security: 5 })
  })

  it('tolerates surrounding whitespace and a trailing newline', () => {
    expect(parseAptCheck(' 3;1\n')).toEqual({ updates: 3, security: 1 })
  })

  it('returns null for empty output rather than reporting zero updates', () => {
    // An empty string means we failed to read the tool, not that the box is
    // up to date — those must not look the same.
    expect(parseAptCheck('')).toBeNull()
    expect(parseAptCheck('   ')).toBeNull()
  })

  it('returns null for unparseable output', () => {
    expect(parseAptCheck('command not found')).toBeNull()
    expect(parseAptCheck('51')).toBeNull()
    expect(parseAptCheck('a;b')).toBeNull()
  })
})

describe('parseRebootPackages', () => {
  it('lists one package per line', () => {
    expect(parseRebootPackages('libc6\nlinux-image-6.8.0-138-generic\nlinux-base\n')).toEqual([
      'libc6',
      'linux-image-6.8.0-138-generic',
      'linux-base',
    ])
  })

  it('drops blank lines and trims', () => {
    expect(parseRebootPackages('  libc6  \n\n\nlinux-base\n')).toEqual(['libc6', 'linux-base'])
  })

  it('is empty for empty input', () => {
    expect(parseRebootPackages('')).toEqual([])
  })
})

describe('buildSystemUpdatePhases', () => {
  const phases = buildSystemUpdatePhases()

  it('refreshes the package lists before upgrading', () => {
    expect(phases).toHaveLength(2)
    expect(phases[0].shell).toMatch(/apt-get\b.*\bupdate\b/)
    expect(phases[1].shell).toMatch(/apt-get\b.*\bupgrade\b/)
  })

  // apt will otherwise stop on a config-file prompt and hang the job forever,
  // since a job has no tty to answer it.
  it('runs non-interactively and keeps existing config files', () => {
    const upgrade = phases[1].shell
    expect(upgrade).toContain('DEBIAN_FRONTEND=noninteractive')
    expect(upgrade).toContain('--force-confold')
    expect(upgrade).toMatch(/\s-y\b/)
  })

  // `upgrade` never removes a package; `dist-upgrade` will. On a box running a
  // customer's gateway that difference matters more than pulling every last
  // held-back package.
  it('uses upgrade rather than dist-upgrade', () => {
    expect(phases[1].shell).not.toContain('dist-upgrade')
    expect(phases[1].shell).not.toContain('full-upgrade')
  })
})

describe('buildRebootCommand', () => {
  // The reboot has to outlive the HTTP response — issuing it inline kills the
  // server mid-reply and the dashboard shows a network error instead of a
  // confirmation.
  it('schedules the reboot rather than running it inline', () => {
    const cmd = buildRebootCommand()
    expect(cmd).toMatch(/sleep|--on-active|shutdown -r \+/)
    expect(cmd).toMatch(/reboot|shutdown -r/)
  })
})
