/** OS package updates for Debian/Ubuntu hosts.
 *
 * Detection uses update-notifier's `apt-check`, which needs no root and prints
 * `<updates>;<security>` — on **stderr**, with stdout empty. Reading stdout
 * quietly reports "no updates" on a box with dozens pending, so the reader has
 * to take stderr. Verified on the throwaway (Ubuntu 24.04): "51;0". */

export interface AptCounts {
  updates: number
  security: number
}

/** Parse apt-check output. Returns null when the tool could not be read at all
 * — "we don't know" and "nothing to update" must not look the same. */
export function parseAptCheck(raw: string): AptCounts | null {
  const m = raw.trim().match(/^(\d+);(\d+)$/)
  if (!m) return null
  return { updates: Number(m[1]), security: Number(m[2]) }
}

/** /var/run/reboot-required.pkgs — one package name per line. */
export function parseRebootPackages(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

import { dpkgRepairShell, DPKG_REPAIR_LABEL } from './dpkg-repair'

export interface UpdatePhase {
  name: string
  shell: string
}

/** The upgrade itself.
 *
 * `upgrade`, not `dist-upgrade`: it never removes a package. On a box running a
 * customer's gateway, not removing anything matters more than pulling in the
 * last few held-back packages.
 *
 * A job has no tty, so apt must not be able to ask anything: noninteractive
 * frontend plus --force-confold, or a package shipping a changed config file
 * stops the run and it hangs until the job times out. */
export function buildSystemUpdatePhases(): UpdatePhase[] {
  const nonInteractive =
    'sudo DEBIAN_FRONTEND=noninteractive apt-get -y ' +
    '-o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef'
  return [
    // 上次 apt 被中斷（MCC 重啟、主機重開）會留下 dpkg interrupted，之後每次 apt 都失敗；先自癒，失敗只記 log
    { name: DPKG_REPAIR_LABEL, shell: dpkgRepairShell() },
    { name: 'apt-get update', shell: `${nonInteractive} update 2>&1` },
    { name: 'apt-get upgrade', shell: `${nonInteractive} upgrade 2>&1` },
  ]
}

/** Reboot, detached so the HTTP response gets out first. Running `systemctl
 * reboot` inline kills the server mid-reply and the dashboard shows a network
 * error instead of a confirmation. */
export function buildRebootCommand(): string {
  return 'sh -c "sleep 3; sudo systemctl reboot" >/dev/null 2>&1 &'
}
