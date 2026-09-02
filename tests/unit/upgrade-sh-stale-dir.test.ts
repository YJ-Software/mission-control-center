import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server } from 'node:http'

/**
 * Regression: upgrade.sh reused versions/vX whenever the directory existed,
 * without checking that its contents matched the tarball.
 *
 * That silently shipped stale code whenever a version number was reused with
 * different content — which is exactly what happens while iterating on a build.
 * On 2026-09-02 it made a release candidate "pass" 19 E2E specs while the box
 * was actually still serving an older build: the deploy logged
 * "✓ upgraded to v0.3.84" and /api/health reported the OLD commit. The security
 * fix under test was not in the running code at all.
 *
 * The reuse now requires the extracted version.json to match the tarball's.
 */

const SCRIPT = resolve(__dirname, '../../deploy/release/upgrade.sh')

let dir: string
let server: Server | null = null
let port = 0

function startHealth(servedFile: string): Promise<number> {
  return new Promise((res) => {
    server = createServer((req, resp) => {
      if (!req.url?.startsWith('/api/health')) { resp.writeHead(404); resp.end(); return }
      const v = existsSync(servedFile) ? readFileSync(servedFile, 'utf8').trim() : ''
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.end(JSON.stringify({ status: 'ok', mccVersion: v }))
    })
    server.listen(0, '127.0.0.1', () => res((server!.address() as any).port))
  })
}

/** An install already holding versions/vTARGET with STALE content. */
function fixture(target: string, staleCommit: string, freshCommit: string) {
  const prefix = join(dir, 'mission-control')
  const state = join(dir, '.mission-control')
  const versionDir = join(prefix, 'versions', `v${target}`)
  mkdirSync(versionDir, { recursive: true })
  mkdirSync(join(state, 'data'), { recursive: true })
  mkdirSync(join(prefix, 'versions', 'v0.0.1'), { recursive: true })
  symlinkSync(join(prefix, 'versions', 'v0.0.1'), join(prefix, 'current'))

  // Stale tree already sitting at the target path.
  writeFileSync(join(versionDir, 'version.json'),
    JSON.stringify({ mccVersion: target, commit: staleCommit }))
  writeFileSync(join(versionDir, 'marker.txt'), 'STALE')

  const servedFile = join(dir, 'served-version')
  writeFileSync(servedFile, '0.0.1')

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

  // Fresh tarball: same version number, different commit + marker.
  const staging = join(dir, 'staging')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'version.json'),
    JSON.stringify({ mccVersion: target, commit: freshCommit }))
  writeFileSync(join(staging, 'marker.txt'), 'FRESH')
  const tarball = join(dir, `mission-control-v${target}-linux-x64.tar.gz`)
  execFileSync('tar', ['czf', tarball, '-C', staging, '.'])

  return { prefix, state, bin, tarball, servedFile, versionDir }
}

const execFileAsync = promisify(execFile)

async function runUpgrade(f: ReturnType<typeof fixture>): Promise<string> {
  writeFileSync(join(f.state, '.env.local'), `PORT=${port}\n`)
  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, f.tarball], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, PREFIX: f.prefix, STATE: f.state, HEALTH_TIMEOUT: '5' },
    })
    return stdout
  } catch (err: any) {
    return String(err.stdout ?? '') + String(err.stderr ?? '')
  }
}

describe('upgrade.sh stale version dir', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-stale-'))
  })
  afterEach(() => {
    server?.close(); server = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('re-extracts when the existing dir holds a different build', async () => {
    const f = fixture('0.3.84', 'aaaaaaa', 'bbbbbbb')
    port = await startHealth(f.servedFile)
    await runUpgrade(f)

    // The decisive assertion: the stale marker must be gone.
    expect(readFileSync(join(f.versionDir, 'marker.txt'), 'utf8')).toBe('FRESH')
    const v = JSON.parse(readFileSync(join(f.versionDir, 'version.json'), 'utf8'))
    expect(v.commit).toBe('bbbbbbb')
  })

  it('still reuses when the existing dir matches the tarball (no wasted re-extract)', async () => {
    const f = fixture('0.3.84', 'sameone', 'sameone')
    // Make the existing tree byte-identical to what the tarball carries.
    writeFileSync(join(f.versionDir, 'marker.txt'), 'FRESH')
    port = await startHealth(f.servedFile)
    const out = await runUpgrade(f)
    expect(out).toMatch(/reusing existing/)
  })
})
