import { execFileSync } from 'child_process'
import { getServerEnv } from '@/lib/server-env'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'

const env = getServerEnv()

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000, env }).trim()
  } catch {
    return ''
  }
}

export interface ServiceInfo {
  name: string
  active: boolean | null
  version?: string
}

function isSystemdActive(unit: string): boolean {
  for (const args of [
    ['is-active', '--quiet', unit],
    ['--user', 'is-active', '--quiet', unit],
  ]) {
    try {
      execFileSync('systemctl', args, { stdio: 'ignore', timeout: 3000, env })
      return true
    } catch { /* not active in this scope */ }
  }
  return false
}

function hasProcess(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-fa', '--', pattern], { stdio: 'ignore', timeout: 3000, env })
    return true
  } catch {
    return false
  }
}

interface ServiceDetector {
  name: string
  systemd: string[]
  processes: string[]
  /** Only show if this binary exists on the system */
  onlyIfInstalled?: string
  /** Command to get version string */
  versionCmd?: { cmd: string; args: string[]; regex?: RegExp }
}

const SERVICE_DETECTORS: ServiceDetector[] = [
  {
    name: 'openclaw',
    systemd: ['openclaw', 'openclaw-gateway', 'openclaw-webhooks'],
    processes: ['openclaw-gateway', 'openclaw-webhooks'],
    versionCmd: { cmd: 'openclaw', args: ['--version'], regex: /OpenClaw\s+([\d.]+)/ },
  },
  {
    name: 'tailscaled',
    systemd: ['tailscaled'],
    processes: ['tailscaled'],
  },
  {
    name: 'imunify-antivirus',
    systemd: ['imunify-antivirus', 'imunify-antivirus.socket'],
    processes: ['imav.run'],
    onlyIfInstalled: 'imunify-antivirus',
  },
  {
    name: 'opencli',
    systemd: ['opencli-daemon'],
    processes: ['@jackwener/opencli'],
    onlyIfInstalled: 'opencli',
    versionCmd: { cmd: 'opencli', args: ['--version'], regex: /(\d+\.\d+\.\d+)/ },
  },
]

function isBinaryInstalled(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: 'ignore', timeout: 3000, env })
    return true
  } catch {
    return false
  }
}

/**
 * Detect service status: try systemd units first, then process patterns.
 * Services with `onlyIfInstalled` are skipped if the binary is not found.
 */
export function getServicesStatus(): ServiceInfo[] {
  return SERVICE_DETECTORS
    .filter(det => !det.onlyIfInstalled || isBinaryInstalled(det.onlyIfInstalled))
    .map(det => {
      const active = det.systemd.some(isSystemdActive) || det.processes.some(hasProcess)
      let version: string | undefined
      if (det.versionCmd) {
        const raw = runQuiet(det.versionCmd.cmd, det.versionCmd.args)
        if (raw) {
          const match = det.versionCmd.regex ? raw.match(det.versionCmd.regex) : null
          version = match ? match[1] : raw.split('\n')[0]
        }
      }
      return { name: det.name, active, version }
    })
}

export interface OpenClawVersionInfo {
  installed: string
  latest: string
  updateAvailable: boolean
}

/**
 * Check OpenClaw installed version vs latest on npm.
 *
 * The systemd user service runs without nvm's PATH so a bare `openclaw` /
 * `npm` won't resolve when openclaw lives under ~/.nvm/versions/node/<ver>/bin.
 * Resolve openclaw via findOpenclawBin() and hit the npm registry directly
 * instead of relying on the `npm` CLI being on PATH.
 */
export async function getOpenClawVersionInfo(): Promise<OpenClawVersionInfo> {
  const bin = findOpenclawBin()
  const raw = runQuiet(bin, ['--version'])
  const match = raw.match(/OpenClaw\s+([\d.]+)/) || raw.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  const installed = match ? match[1] : ''

  let latest = ''
  try {
    const res = await fetch('https://registry.npmjs.org/openclaw/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = (await res.json()) as { version?: string }
      if (typeof data.version === 'string') latest = data.version
    }
  } catch { /* ignore */ }

  return {
    installed,
    latest,
    updateAvailable: !!(installed && latest && installed !== latest),
  }
}

export interface OpencliVersionInfo {
  installed: string
  latest: string
  updateAvailable: boolean
}

/**
 * Check OpenCLI (browser-automation bridge, npm `@jackwener/opencli`) installed
 * version vs latest on npm. Mirrors getOpenClawVersionInfo() — resolves the
 * registry directly rather than relying on `npm` being on the unit's PATH.
 * Returns installed='' when opencli isn't installed (caller hides the row).
 */
export async function getOpencliVersionInfo(): Promise<OpencliVersionInfo> {
  const raw = runQuiet('opencli', ['--version'])
  const match = raw.match(/(\d+\.\d+\.\d+)/)
  const installed = match ? match[1] : ''

  let latest = ''
  if (installed) {
    try {
      // Scoped package — the slash must be URL-encoded for the registry path.
      const res = await fetch('https://registry.npmjs.org/@jackwener%2Fopencli/latest', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = (await res.json()) as { version?: string }
        if (typeof data.version === 'string') latest = data.version
      }
    } catch { /* ignore */ }
  }

  return {
    installed,
    latest,
    updateAvailable: !!(installed && latest && installed !== latest),
  }
}

export interface TailscaleInfo {
  hostname: string
  ip: string
  online: boolean
  peers: number
  routes: string[]
  error?: string
}

/**
 * Get detailed Tailscale status via `tailscale status --json`.
 */
export function getTailscaleStatus(): TailscaleInfo {
  try {
    const raw = runQuiet('tailscale', ['status', '--json'])
    if (!raw) {
      return { hostname: '--', ip: '--', online: false, peers: 0, routes: [], error: 'Tailscale not available' }
    }

    const status = JSON.parse(raw)
    const self = status.Self || {}
    const peers = Object.values(status.Peer || {}).filter((p: any) => p.Online).length

    let routes: string[] = []
    try {
      const serveRaw = runQuiet('tailscale', ['serve', 'status'])
      if (serveRaw && !serveRaw.includes('No serve config')) {
        routes = serveRaw.split('\n').filter(l => l.includes('http')).map(l => l.trim())
      }
    } catch { /* ignore */ }

    return {
      hostname: self.HostName || 'unknown',
      ip: self.TailscaleIPs?.[0] || 'unknown',
      online: self.Online || false,
      peers,
      routes,
    }
  } catch {
    return { hostname: '--', ip: '--', online: false, peers: 0, routes: [], error: 'Tailscale not available' }
  }
}
