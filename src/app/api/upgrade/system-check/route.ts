import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getServerEnv } from '@/lib/server-env'
import { parseAptCheck, parseRebootPackages } from '@/lib/system-update/apt'

const execFileP = promisify(execFile)

const APT_CHECK = '/usr/lib/update-notifier/apt-check'
const REBOOT_FLAG = '/var/run/reboot-required'
const REBOOT_PKGS = '/var/run/reboot-required.pkgs'

/** GET — pending OS package updates and whether a reboot is queued.
 *
 * `manager: null` means this host is not a Debian/Ubuntu box with
 * update-notifier, or we could not read it. The header treats that as "nothing
 * to show" rather than "up to date": not knowing and being current are
 * different states and must not render the same. */
export async function GET() {
  const rebootRequired = existsSync(REBOOT_FLAG)
  let rebootPackages: string[] = []
  if (rebootRequired && existsSync(REBOOT_PKGS)) {
    try {
      rebootPackages = parseRebootPackages(readFileSync(REBOOT_PKGS, 'utf8'))
    } catch {
      /* the flag alone is enough to offer the reboot */
    }
  }

  if (!existsSync(APT_CHECK)) {
    return NextResponse.json({
      manager: null,
      updates: 0,
      security: 0,
      rebootRequired,
      rebootPackages,
    })
  }

  try {
    // apt-check writes "<updates>;<security>" to stderr, not stdout.
    const { stderr } = await execFileP(APT_CHECK, [], {
      timeout: 30_000,
      env: getServerEnv(),
    })
    const counts = parseAptCheck(stderr)
    if (!counts) {
      return NextResponse.json({
        manager: null,
        updates: 0,
        security: 0,
        rebootRequired,
        rebootPackages,
      })
    }
    return NextResponse.json({
      manager: 'apt',
      updates: counts.updates,
      security: counts.security,
      rebootRequired,
      rebootPackages,
    })
  } catch {
    return NextResponse.json({
      manager: null,
      updates: 0,
      security: 0,
      rebootRequired,
      rebootPackages,
    })
  }
}
