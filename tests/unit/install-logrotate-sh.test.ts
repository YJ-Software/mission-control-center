import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Runs the real deploy/release/install-logrotate.sh against a throwaway HOME
 * with `systemctl` and `logrotate` stubbed on PATH, so nothing touches the
 * machine's user systemd instance.
 */
const RELEASE_DIR = resolve(__dirname, '../../deploy/release')
const SCRIPT = join(RELEASE_DIR, 'install-logrotate.sh')

let dir: string
let home: string
let bin: string
let calls: string

function stub(name: string, body: string) {
  const p = join(bin, name)
  writeFileSync(p, `#!/bin/bash\n${body}\n`)
  chmodSync(p, 0o755)
}

function run(pathDirs: string[]) {
  return execFileSync('bash', [SCRIPT, RELEASE_DIR, join(dir, 'state'), 'mission-control'], {
    env: { ...process.env, HOME: home, PATH: pathDirs.join(':') },
    encoding: 'utf8',
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcc-lr-'))
  home = join(dir, 'home')
  bin = join(dir, 'bin')
  calls = join(dir, 'calls.log')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin)
  stub('systemctl', `echo "systemctl $*" >> ${calls}`)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('install-logrotate.sh', () => {
  it('renders units against the state dir and enables the timer', () => {
    stub('logrotate', 'exit 0')
    run([bin, '/usr/bin', '/bin'])

    const unitDir = join(home, '.config/systemd/user')
    const conf = readFileSync(join(dir, 'state', 'logrotate.conf'), 'utf8')
    const svc = readFileSync(join(unitDir, 'mission-control-logrotate.service'), 'utf8')

    expect(conf).toContain(`${join(dir, 'state')}/logs/mission-control.log {`)
    // The one directive that must never regress: see the conf template.
    expect(conf).toMatch(/^\s*copytruncate$/m)
    expect(conf).not.toContain('__STATE__')
    expect(svc).toContain(`ExecStart=${join(bin, 'logrotate')} --state ${join(dir, 'state')}/logrotate.state`)
    expect(existsSync(join(unitDir, 'mission-control-logrotate.timer'))).toBe(true)
    expect(readFileSync(calls, 'utf8')).toContain('systemctl --user enable --now mission-control-logrotate.timer')
  })

  it('is non-fatal and installs nothing when logrotate is not on PATH', () => {
    const out = run([bin, '/bin'])
    expect(out).toContain('logrotate not found')
    expect(existsSync(join(home, '.config/systemd/user/mission-control-logrotate.timer'))).toBe(false)
    expect(existsSync(calls)).toBe(false)
  })
})
