import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { parseRebootPackages } from '@/lib/system-update/apt'
import { pendingAptCounts } from '@/lib/system-update/check'

const REBOOT_FLAG = '/var/run/reboot-required'
const REBOOT_PKGS = '/var/run/reboot-required.pkgs'

/** GET — pending OS package updates and whether a reboot is queued.
 *
 * `manager: null` means this host is not a Debian/Ubuntu box with
 * update-notifier, or we could not read it. The header treats that as "nothing
 * to show" rather than "up to date": not knowing and being current are
 * different states and must not render the same. */
export async function GET() {
  const counts = await pendingAptCounts()
  const rebootRequired = existsSync(REBOOT_FLAG)
  let rebootPackages: string[] = []
  if (rebootRequired && existsSync(REBOOT_PKGS)) {
    try {
      rebootPackages = parseRebootPackages(readFileSync(REBOOT_PKGS, 'utf8'))
    } catch {
      /* the flag alone is enough to offer the reboot */
    }
  }

  return NextResponse.json({
    manager: counts ? 'apt' : null,
    updates: counts?.updates ?? 0,
    security: counts?.security ?? 0,
    rebootRequired,
    rebootPackages,
  })
}
