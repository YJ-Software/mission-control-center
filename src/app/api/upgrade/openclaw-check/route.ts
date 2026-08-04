import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'
import { parseCliVersion, isUpdateAvailable } from '@/lib/version-compare'

const execFileP = promisify(execFile)

async function readCurrentVersion(): Promise<string | null> {
  const bin = findOpenclawBin()
  try {
    const { stdout } = await execFileP(bin, ['--version'], { timeout: 5000 })
    // Output examples:
    //   "OpenClaw 2026.5.5 (b1abf9d) — One CLI to rule them all..."
    //   "OpenClaw 2026.7.1-2 (0790d9f) — ..."
    //   "2026.5.5"
    // The build suffix (`-2`) is part of the version — dropping it misreports
    // which build is installed, and comparing it as a dotted segment loses it
    // just as badly (`parseInt('1-2') === 1`).
    return parseCliVersion(stdout, 'OpenClaw') || null
  } catch {
    return null
  }
}

async function readLatestVersion(): Promise<{ version: string; publishedAt: string | null }> {
  const res = await fetch('https://registry.npmjs.org/openclaw/latest', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`)
  const data = (await res.json()) as { version?: string; time?: string }
  if (typeof data.version !== 'string') throw new Error('npm response missing version')
  return { version: data.version, publishedAt: typeof data.time === 'string' ? data.time : null }
}

export async function GET() {
  try {
    const current = await readCurrentVersion()
    if (!current) {
      return NextResponse.json({
        installed: false,
        current: null,
        latest: null,
        hasUpdate: false,
        installCommand: 'npm install -g openclaw@latest',
      })
    }
    const latest = await readLatestVersion()
    const hasUpdate = isUpdateAvailable(current, latest.version)
    return NextResponse.json({
      installed: true,
      current,
      latest: latest.version,
      latestPublishedAt: latest.publishedAt,
      hasUpdate,
      installCommand: `npm install -g openclaw@${latest.version}`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
