import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

interface VersionInfo {
  /** Display version: `<openclawVersion>-v<mccVersion>` when paired, else `<mccVersion>`. */
  version: string
  /** Raw MCC semver (e.g. "0.3.52"). Use this for ordering / upgrade comparisons. */
  mccVersion: string
  /** OpenClaw version this build was paired with (e.g. "2026.6.1"). null if unknown. */
  openclawVersion: string | null
  commit: string | null
  buildTime: string
}

interface BakedVersion {
  version?: string
  mccVersion?: string
  openclawVersion?: string | null
  commit?: string
  buildTime?: string
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json')
    const raw = readFileSync(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function readGitCommit(): string | null {
  // Build-time injection wins (CI may strip .git from the deployed tree).
  const envCommit = process.env.NEXT_PUBLIC_GIT_COMMIT || process.env.GIT_COMMIT
  if (envCommit) return envCommit.trim().slice(0, 7)
  try {
    const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000,
    })
    const sha = out.trim()
    return sha || null
  } catch {
    return null
  }
}

function computeBuildTime(): string {
  const envTime = process.env.NEXT_PUBLIC_BUILD_TIME || process.env.BUILD_TIME
  if (envTime) return envTime
  return new Date().toISOString()
}

function loadBakedVersionJson(): BakedVersion | null {
  // Release tarballs ship a version.json alongside server.js so the server
  // doesn't need to invoke git at runtime (the deployed tree has no .git).
  try {
    const p = path.resolve(process.cwd(), 'version.json')
    const raw = readFileSync(p, 'utf8')
    return JSON.parse(raw) as BakedVersion
  } catch {
    return null
  }
}

/** Combine semver + openclaw version into the display string we ship on
 *  release tags, manifest entries, and /api/health. */
export function formatDisplayVersion(mccVersion: string, openclawVersion: string | null): string {
  return openclawVersion ? `${openclawVersion}-v${mccVersion}` : mccVersion
}

/** Extract MCC semver from a display version like `2026.6.1-v0.3.52`.
 *  Tolerates the unpaired form `0.3.52`. */
export function parseMccVersion(s: string): string {
  const m = s.match(/-v(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/)
  return m ? m[1] : s
}

const baked = loadBakedVersionJson()
const mccVersion = baked?.mccVersion || readPackageVersion()
const openclawVersion = baked?.openclawVersion ?? null
const cached: VersionInfo = {
  version: baked?.version || formatDisplayVersion(mccVersion, openclawVersion),
  mccVersion,
  openclawVersion,
  commit: baked?.commit ?? readGitCommit(),
  buildTime: baked?.buildTime || computeBuildTime(),
}

export function getVersionInfo(): VersionInfo {
  return cached
}
