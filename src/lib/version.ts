import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

interface VersionInfo {
  version: string
  commit: string | null
  buildTime: string
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

function loadBakedVersionJson(): Partial<VersionInfo> | null {
  // Release tarballs ship a version.json alongside server.js so the server
  // doesn't need to invoke git at runtime (the deployed tree has no .git).
  try {
    const p = path.resolve(process.cwd(), 'version.json')
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as Partial<VersionInfo>
    return parsed
  } catch {
    return null
  }
}

const baked = loadBakedVersionJson()
const cached: VersionInfo = {
  version: baked?.version || readPackageVersion(),
  commit: baked?.commit ?? readGitCommit(),
  buildTime: baked?.buildTime || computeBuildTime(),
}

export function getVersionInfo(): VersionInfo {
  return cached
}
