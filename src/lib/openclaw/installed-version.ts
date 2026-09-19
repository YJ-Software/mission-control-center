import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'
import { parseCliVersion } from '@/lib/version-compare'

const execFileP = promisify(execFile)

/**
 * The installed OpenClaw version, build suffix included.
 *
 * Output examples:
 *   "OpenClaw 2026.5.5 (b1abf9d) — One CLI to rule them all..."
 *   "OpenClaw 2026.7.1-2 (0790d9f) — ..."
 *   "2026.5.5"
 * The build suffix (`-2`) is part of the version — dropping it misreports
 * which build is installed, and comparing it as a dotted segment loses it
 * just as badly (`parseInt('1-2') === 1`).
 *
 * Returns null when the CLI is missing or unreadable.
 */
export async function readInstalledOpenclawVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileP(findOpenclawBin(), ['--version'], { timeout: 5000 })
    return parseCliVersion(stdout, 'OpenClaw') || null
  } catch {
    return null
  }
}
