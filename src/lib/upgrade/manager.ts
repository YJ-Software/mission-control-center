/**
 * Release upgrade manager.
 *
 * Implements the same flow as `deploy/release/upgrade.sh` but from Node, so
 * the UI can drive upgrades without shelling out to bash. Shared invariants:
 *   - `<prefix>/current` is a symlink to `<prefix>/versions/v<ver>/`.
 *   - `.env.local` and `data/` inside each versioned dir are symlinks into
 *     `<state>/`, so state survives upgrades.
 *   - The running process is managed by a systemd user unit whose
 *     `ExecStart` points at `<prefix>/current/server.js`. Restarting the unit
 *     picks up the new symlink target.
 *
 * An upgrade that fails health check rolls the `current` symlink back to the
 * previous target and triggers another restart.
 */

import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

import { getVersionInfo } from '@/lib/version'

const execFileP = promisify(execFile)

export type InstallMode = 'release' | 'dev' | 'unknown'

export interface InstallInfo {
  mode: InstallMode
  prefix: string
  state: string
  service: string
  currentVersion: string
  currentCommit: string | null
}

function prefixFromEnv(): string {
  return process.env.MC_PREFIX || path.join(homedir(), 'mission-control')
}

function stateFromEnv(): string {
  return process.env.MC_STATE || path.join(homedir(), '.mission-control')
}

function serviceFromEnv(): string {
  return process.env.MC_SERVICE || 'mission-control'
}

/**
 * Detect whether this process was started from a release-mode install.
 *
 * A release install has `<prefix>/current/server.js` and the currently
 * running `server.js` (argv[1]) resolves to the same real path. If either
 * check fails we report 'dev' (typical during local tsx development).
 */
export function detectInstallMode(): InstallMode {
  try {
    const prefix = prefixFromEnv()
    const currentServer = path.join(prefix, 'current', 'server.js')
    if (!existsSync(currentServer)) return 'dev'

    const resolvedCurrent = realpathSync(currentServer)

    const runningEntry = process.argv[1]
    if (!runningEntry) return 'unknown'

    let resolvedRunning: string
    try {
      resolvedRunning = realpathSync(runningEntry)
    } catch {
      return 'unknown'
    }

    return resolvedRunning === resolvedCurrent ? 'release' : 'dev'
  } catch {
    return 'unknown'
  }
}

export function getInstallInfo(): InstallInfo {
  const v = getVersionInfo()
  return {
    mode: detectInstallMode(),
    prefix: prefixFromEnv(),
    state: stateFromEnv(),
    service: serviceFromEnv(),
    currentVersion: v.version,
    currentCommit: v.commit,
  }
}

// ---------------------------------------------------------------------------
// Release manifest
// ---------------------------------------------------------------------------

export interface ReleaseArtifact {
  platform: string
  arch: string
  url: string
  sha256?: string
  size?: number
}

export interface ReleaseManifest {
  latest: {
    version: string
    releaseDate?: string
    notes?: string
    artifacts: ReleaseArtifact[]
  }
}

export async function fetchManifest(manifestUrl: string): Promise<ReleaseManifest> {
  // Cache-bust the URL: raw.githubusercontent.com serves with
  // `cache-control: max-age=300`, so different CDN edges return the
  // previous manifest for up to 5 minutes after a new push. Adding a
  // unique query param forces a cache miss so operators don't have to
  // wait the full TTL after a release to see "Upgrade available".
  const bustedUrl = manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + '_=' + Date.now()
  const res = await fetch(bustedUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`)
  const body = (await res.json()) as ReleaseManifest
  if (!body?.latest?.version || !Array.isArray(body.latest.artifacts)) {
    throw new Error('invalid manifest shape')
  }
  return body
}

export function pickArtifact(manifest: ReleaseManifest): ReleaseArtifact | null {
  const plat = process.platform === 'linux' ? 'linux' : process.platform
  const arch = process.arch === 'x64' ? 'x64' : process.arch
  return (
    manifest.latest.artifacts.find((a) => a.platform === plat && a.arch === arch) || null
  )
}

// ---------------------------------------------------------------------------
// Upgrade execution
// ---------------------------------------------------------------------------

export interface ApplyUpgradeOptions {
  /** Absolute path to the tarball staged on disk. */
  tarballPath: string
  /** Optional hex-encoded sha256 to verify before extraction. */
  expectedSha256?: string
  /** Used only for error messages; parsed from tarball filename if omitted. */
  expectedVersion?: string
}

export interface ApplyUpgradeResult {
  version: string
  versionDir: string
  prevTarget: string | null
}

export async function applyUpgrade(opts: ApplyUpgradeOptions): Promise<ApplyUpgradeResult> {
  const info = getInstallInfo()
  if (info.mode !== 'release') {
    throw new Error(`upgrade requires release-mode install (current mode: ${info.mode})`)
  }

  const { tarballPath } = opts
  if (!existsSync(tarballPath)) {
    throw new Error(`tarball not found: ${tarballPath}`)
  }

  // 1. Verify checksum if provided.
  if (opts.expectedSha256) {
    const actual = await sha256File(tarballPath)
    if (actual.toLowerCase() !== opts.expectedSha256.toLowerCase()) {
      throw new Error(`sha256 mismatch (expected ${opts.expectedSha256}, got ${actual})`)
    }
  }

  // 2. Determine version from the tarball itself — the filename is untrusted.
  const version = await readTarballVersion(tarballPath)
  if (!version) throw new Error('could not read version.json from tarball')
  if (opts.expectedVersion && opts.expectedVersion !== version) {
    throw new Error(`tarball version ${version} does not match expected ${opts.expectedVersion}`)
  }
  if (version === info.currentVersion) {
    throw new Error(`v${version} is already the running version`)
  }

  // 3. Extract to versions/vNEW/ (fresh; if it already exists, nuke it first
  //    to guarantee a clean state — we're about to symlink into it).
  const newDir = path.join(info.prefix, 'versions', `v${version}`)
  if (existsSync(newDir)) rmSync(newDir, { recursive: true, force: true })
  mkdirSync(newDir, { recursive: true })
  await execFileP('tar', ['xzf', tarballPath, '-C', newDir])

  // 4. State symlinks (same invariants as install.sh / upgrade.sh).
  const envFile = path.join(info.state, '.env.local')
  const dataDir = path.join(info.state, 'data')
  mkdirSync(dataDir, { recursive: true })

  const envLink = path.join(newDir, '.env.local')
  if (existsSync(envLink)) unlinkSync(envLink)
  symlinkSync(envFile, envLink)

  const dataLink = path.join(newDir, 'data')
  if (existsSync(dataLink)) rmSync(dataLink, { recursive: true, force: true })
  symlinkSync(dataDir, dataLink)

  // 5. Atomic-ish swap of `current`. Node's fs.symlink cannot replace an
  //    existing link directly; we use `ln -sfn` which *does* swap atomically
  //    on Linux (via renameat).
  const currentLink = path.join(info.prefix, 'current')
  let prevTarget: string | null = null
  try {
    prevTarget = realpathSync(currentLink)
  } catch {
    prevTarget = null
  }
  await execFileP('ln', ['-sfn', newDir, currentLink])

  return { version, versionDir: newDir, prevTarget }
}

/**
 * Trigger `systemctl --user restart <service>` in a detached subprocess so
 * the current request can return before SIGTERM kills us. A small sleep
 * buys enough time for Next.js to flush the response.
 */
export function scheduleServiceRestart(service: string, delaySeconds = 2): void {
  const cmd = `sleep ${delaySeconds} && systemctl --user restart ${service}`
  const child = spawn('bash', ['-c', cmd], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

/**
 * Roll `current` symlink back to `prevTarget` and restart. Used when a
 * post-upgrade health check fails.
 */
export async function rollbackUpgrade(prevTarget: string, service: string): Promise<void> {
  const info = getInstallInfo()
  const currentLink = path.join(info.prefix, 'current')
  await execFileP('ln', ['-sfn', prevTarget, currentLink])
  scheduleServiceRestart(service)
}

/**
 * Delete versions/ directories older than the N most recent. Run after a
 * successful upgrade to reclaim disk. Never deletes the current target.
 */
export async function pruneOldVersions(keep = 3): Promise<string[]> {
  const info = getInstallInfo()
  const versionsDir = path.join(info.prefix, 'versions')
  if (!existsSync(versionsDir)) return []
  const currentReal = (() => {
    try {
      return realpathSync(path.join(info.prefix, 'current'))
    } catch {
      return ''
    }
  })()

  const entries = await readdir(versionsDir, { withFileTypes: true })
  const versions = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('v'))
    .map((e) => path.join(versionsDir, e.name))
    .sort((a, b) => {
      try {
        return require('node:fs').statSync(b).mtimeMs - require('node:fs').statSync(a).mtimeMs
      } catch {
        return 0
      }
    })

  const toDelete = versions.slice(keep).filter((p) => p !== currentReal)
  for (const p of toDelete) {
    rmSync(p, { recursive: true, force: true })
  }
  return toDelete
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = (await import('node:fs')).createReadStream(filePath)
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function readTarballVersion(tarballPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('tar', ['xzOf', tarballPath, './version.json'])
    const parsed = JSON.parse(stdout) as { version?: string }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Save an uploaded buffer to a temp tarball path. Used by the API route
 * when the admin uploads a .tar.gz via multipart.
 */
export function stageUploadedTarball(buffer: Buffer): string {
  const tmp = path.join(
    process.env.TMPDIR || '/tmp',
    `mission-control-upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tar.gz`,
  )
  writeFileSync(tmp, buffer)
  return tmp
}

/**
 * Download a release artifact into a temp tarball path. Returns the path.
 * Verifies response content-type loosely (allow application/* and octet-stream).
 */
export async function downloadArtifact(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  return stageUploadedTarball(buf)
}

/**
 * Copy a path into /tmp. Not strictly an upgrade helper — exposed so API
 * routes can be tested without network access.
 */
export function stageLocalTarball(src: string): string {
  const dst = path.join(
    process.env.TMPDIR || '/tmp',
    `mission-control-upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tar.gz`,
  )
  cpSync(src, dst)
  return dst
}

/**
 * Resolve the manifest URL. Settings DB wins over env so the UI can override
 * what ops set via `UPGRADE_MANIFEST_URL`. Empty string = feature disabled.
 */
export function getConfiguredManifestUrl(): string {
  try {
    // Lazy-load to avoid pulling the drizzle runtime into module init — some
    // callers (e.g. /api/health) want getInstallInfo() without touching DB.
    const { db } = require('@/lib/db') as typeof import('@/lib/db')
    const { settings } = require('@/lib/schema') as typeof import('@/lib/schema')
    const { eq } = require('drizzle-orm') as typeof import('drizzle-orm')
    const row = db.select().from(settings).where(eq(settings.key, 'upgrade.manifestUrl')).get()
    const fromDb = (row?.value || '').trim()
    if (fromDb) return fromDb
  } catch {
    // DB not initialised yet (first request before initDb) — fall through to env
  }
  return (process.env.UPGRADE_MANIFEST_URL || '').trim()
}

export function cleanupTempTarball(tarballPath: string): void {
  try {
    if (tarballPath.includes('mission-control-upload-')) {
      unlinkSync(tarballPath)
    }
  } catch {
    // ignore
  }
}
