import { describe, expect, it, vi } from 'vitest'
import { buildSshArgs } from '../../scripts/e2e/twnoc/lib/ssh.mjs'

describe('buildSshArgs', () => {
  it('includes BatchMode and IdentityFile', () => {
    const args = buildSshArgs({
      user: 'root',
      host: '203.0.113.5',
      keyPath: '/tmp/key',
      command: 'whoami',
    })
    expect(args).toContain('-i')
    expect(args).toContain('/tmp/key')
    expect(args).toContain('-o')
    expect(args).toContain('BatchMode=yes')
    expect(args[args.length - 2]).toBe('root@203.0.113.5')
    expect(args[args.length - 1]).toBe('whoami')
  })

  it('expands ~ in keyPath', () => {
    const args = buildSshArgs({
      user: 'root',
      host: 'h',
      keyPath: '~/.ssh/id_ed25519',
      command: ':',
    })
    const idx = args.indexOf('-i')
    expect(args[idx + 1]).toBe(`${process.env.HOME}/.ssh/id_ed25519`)
  })
})
