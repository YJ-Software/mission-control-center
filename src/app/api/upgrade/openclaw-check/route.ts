import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'

const execFileP = promisify(execFile)

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length, 3)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

async function readCurrentVersion(): Promise<string | null> {
  const bin = findOpenclawBin()
  try {
    const { stdout } = await execFileP(bin, ['--version'], { timeout: 5000 })
    // Output examples:
    //   "OpenClaw 2026.5.5 (b1abf9d) — One CLI to rule them all..."
    //   "2026.5.5"
    // Pull the first dotted numeric run.
    const match = stdout.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
    return match?.[1] ?? null
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
    const hasUpdate = compareVersion(latest.version, current) > 0
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
