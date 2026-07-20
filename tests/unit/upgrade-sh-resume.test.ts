import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'

/**
 * Regression: deploy/release/upgrade.sh used to decide "already the running
 * version — nothing to do" from the `current` symlink alone.
 *
 * A run that swapped the symlink and then died before the service restarted
 * (which happened for real: `systemctl --user` under `sudo -u` can't reach the
 * user D-Bus, and `set -e` aborted right after the swap) left `current` on the
 * NEW version while the OLD process kept serving. Every re-run then reported
 * success and exited without doing anything — the stale code stayed live and
 * the upgrade was unrecoverable by re-running.
 *
 * The decision now keys off /api/health's actually-running version.
 */

const SCRIPT = resolve(__dirname, '../../deploy/release/upgrade.sh')

let dir: string
let server: Server | null = null
let port = 0

/** Health endpoint whose reported version is whatever `servedFile` contains. */
function startHealth(servedFile: string): Promise<number> {
  return new Promise((res) => {
    server = createServer((req, resp) => {
      if (!req.url?.startsWith('/api/health')) {
        resp.writeHead(404); resp.end(); return
      }
      const v = existsSync(servedFile) ? readFileSync(servedFile, 'utf8').trim() : ''
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.end(JSON.stringify({ status: 'ok', mccVersion: v }))
    })
    server.listen(0, '127.0.0.1', () => res((server!.address() as any).port))
  })
}

/**
 * Build the fixture: an install whose `current` already points at TARGET while
 * the service still serves `runningVersion` — i.e. the stranded state.
 */
function fixture(runningVersion: string, target: string) {
  const prefix = join(dir, 'mission-control')
  const state = join(dir, '.mission-control')
  mkdirSync(join(prefix, 'versions', `v${target}`), { recursive: true })
  mkdirSync(join(state, 'data'), { recursive: true })
  symlinkSync(join(prefix, 'versions', `v${target}`), join(prefix, 'current'))

  const servedFile = join(dir, 'served-version')
  writeFileSync(servedFile, runningVersion)

  // A `systemctl` stub: `show-environment` proves the bus is reachable, and
  // `restart` is what finally makes the new version go live.
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const stub = join(bin, 'systemctl')
  writeFileSync(stub, `#!/usr/bin/env bash
for a in "$@"; do
  if [[ "$a" == "restart" ]]; then printf '%s' "${target}" > "${servedFile}"; fi
done
exit 0
`)
  chmodSync(stub, 0o755)

  // Minimal tarball carrying the baked version.json the script reads.
  const staging = join(dir, 'staging')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'version.json'), JSON.stringify({ mccVersion: target }))
  const tarball = join(dir, `mission-control-v${target}-linux-x64.tar.gz`)
  execFileSync('tar', ['czf', tarball, '-C', staging, '.'])

  return { prefix, state, bin, tarball, servedFile }
}

const execFileAsync = promisify(execFile)

/**
 * MUST stay async: the health server below lives in this same process, so a
 * synchronous execFileSync would block the event loop, the server could never
 * answer the script's curl, and the run would hang instead of failing.
 * Returns stdout whether the script succeeds or exits non-zero (the rollback
 * path is a legitimate outcome we assert on).
 */
async function runUpgrade(f: ReturnType<typeof fixture>): Promise<string> {
  writeFileSync(join(f.state, '.env.local'), `PORT=${port}\n`)
  const opts = {
    encoding: 'utf8' as const,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      PREFIX: f.prefix,
      STATE: f.state,
      HEALTH_TIMEOUT: '5',
    },
  }
  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, f.tarball], opts)
    return stdout
  } catch (err: any) {
    return String(err.stdout ?? '')
  }
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcc-upgrade-')) })
afterEach(() => {
  server?.close(); server = null
  rmSync(dir, { recursive: true, force: true })
})

describe('upgrade.sh resume semantics', () => {
  it('completes the upgrade when current points at the target but the service serves an older version', async () => {
    const f = fixture('0.9.0', '1.0.0')
    port = await startHealth(f.servedFile)

    const out = await runUpgrade(f)

    // The regression: this state must NOT be mistaken for "nothing to do".
    expect(out).not.toContain('nothing to do')
    expect(out).toContain('the service is serving 0.9.0')
    expect(out).toContain('completing the interrupted upgrade')
    // And it must actually finish — the stub restart flipped the served version.
    expect(out).toContain('upgraded to Mission Control v1.0.0')
  })

  it('still no-ops when the service really is serving the target version', async () => {
    const f = fixture('1.0.0', '1.0.0')
    port = await startHealth(f.servedFile)

    const out = await runUpgrade(f)

    expect(out).toContain('nothing to do')
    expect(out).not.toContain('completing the interrupted upgrade')
  })

  it('upgrades rather than skipping when the service is down (health unreachable)', async () => {
    const f = fixture('', '1.0.0')
    // Point at a closed port: an unreachable health endpoint must not be read
    // as "already running the target".
    port = 1
    const out = await runUpgrade(f)

    expect(out).not.toContain('nothing to do')
    expect(out).toContain('the service is serving nothing')
    // This path deliberately runs to the health-poll timeout and rolls back,
    // so it needs more than vitest's 5s default.
  }, 25_000)
})
