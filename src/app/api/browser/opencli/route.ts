import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'
import { getBrowserConfig, getChromeBinaryPath } from '@/lib/browser/config'
import { getOpencliExtensionSymlink } from '@/lib/browser/installer'

const execFileAsync = promisify(execFile)

async function getInstalledVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('opencli', ['--version'], {
      timeout: 10000, env: getServerEnv(),
    })
    // e.g. "opencli/1.5.7 linux-x64 node-v22.0.0" → "1.5.7"
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : stdout.trim()
  } catch {
    return null
  }
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', '@jackwener/opencli', 'version'], {
      timeout: 15000, env: getServerEnv(),
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Check if the OpenCLI extension is loaded in Chrome via CDP */
async function isExtensionLoaded(): Promise<boolean> {
  const cdpPort = getBrowserConfig('cdp_port') || '9222'
  try {
    // Check if CDP is reachable
    const versionRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(3000) })
    if (!versionRes.ok) return false

    // List all targets — extension service workers appear here
    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(3000) })
    if (!targetsRes.ok) return false
    const targets = await targetsRes.json() as Array<{ url: string; type: string; title: string }>

    // Check for OpenCLI extension target (service_worker with chrome-extension:// URL)
    // Note: Chrome service workers have title like "Service Worker chrome-extension://..." — the
    // extension name does NOT appear in the title, so we match by URL pattern only.
    return targets.some(t =>
      t.url.startsWith('chrome-extension://') && (t.type === 'service_worker' || t.type === 'background_page')
    )
  } catch {
    return false
  }
}

function isExtensionFilePresent(): boolean {
  return existsSync(join(homedir(), '.opencli', 'extension', 'manifest.json'))
}

function needsManualInstall(): boolean {
  const chromeBin = getChromeBinaryPath()
  return !!chromeBin && !chromeBin.toLowerCase().includes('chromium')
}

/** GET — opencli version info */
export async function GET() {
  try {
    const [installed, latest, extensionLoaded] = await Promise.all([
      getInstalledVersion(),
      getLatestVersion(),
      isExtensionLoaded(),
    ])

    const updateAvailable = !!(installed && latest && installed !== latest)

    return NextResponse.json({
      installed,
      latest,
      updateAvailable,
      extensionLoaded,
      extensionFilePresent: isExtensionFilePresent(),
      extensionPath: existsSync(getOpencliExtensionSymlink())
        ? getOpencliExtensionSymlink()
        : join(homedir(), '.opencli', 'extension'),
      needsManualInstall: needsManualInstall(),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — update opencli */
export async function POST() {
  try {
    const { stdout, stderr } = await execFileAsync(
      'npm', ['install', '-g', '@jackwener/opencli@latest'],
      { timeout: 120000, env: getServerEnv() },
    )

    const version = await getInstalledVersion()

    return NextResponse.json({
      ok: true,
      version,
      output: (stdout + '\n' + stderr).trim(),
    })
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      output: (err.stdout || '') + (err.stderr || '') || err.message,
    }, { status: 500 })
  }
}
