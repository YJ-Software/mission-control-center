import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export interface TailscaleInfo {
  installed: boolean
  running: boolean
  ipv4: string | null
  dnsName: string | null
}

export type HttpsMode = 'off' | 'serve' | 'funnel'

export interface HttpsStatus {
  mode: HttpsMode
  url: string | null
}

function tryExecSync(args: string[], timeoutMs = 3000): string | null {
  try {
    return execFileSync('tailscale', args, { timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

export function getTailscaleInfo(): TailscaleInfo {
  const ipv4Out = tryExecSync(['ip', '-4'])
  const installed = ipv4Out !== null || tryExecSync(['version']) !== null

  if (!installed) {
    return { installed: false, running: false, ipv4: null, dnsName: null }
  }

  const statusJson = tryExecSync(['status', '--json'])
  let dnsName: string | null = null
  let ipv4: string | null = null

  if (statusJson) {
    try {
      const parsed = JSON.parse(statusJson) as {
        Self?: { DNSName?: string; TailscaleIPs?: string[] }
      }
      const raw = parsed?.Self?.DNSName ?? null
      dnsName = raw ? raw.replace(/\.$/, '') : null
      const ips = parsed?.Self?.TailscaleIPs ?? []
      ipv4 = ips.find(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ?? null
    } catch {
      // fall through
    }
  }

  if (!ipv4 && ipv4Out) {
    ipv4 = ipv4Out.split('\n')[0]?.trim() || null
  }

  return { installed: true, running: !!ipv4, ipv4, dnsName }
}

interface ServeConfig {
  AllowFunnel?: Record<string, boolean>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
}

function findMatchingEntry(config: ServeConfig, port: number): string | null {
  const web = config.Web ?? {}
  for (const [hostPort, entry] of Object.entries(web)) {
    const handlers = entry?.Handlers ?? {}
    const matches = Object.values(handlers).some(h =>
      typeof h.Proxy === 'string' && h.Proxy.includes(`:${port}`),
    )
    if (matches) return hostPort
  }
  return null
}

export function getHttpsStatus(port: number): HttpsStatus {
  const json = tryExecSync(['serve', 'status', '--json'])
  if (!json) return { mode: 'off', url: null }

  try {
    const parsed = JSON.parse(json) as ServeConfig
    const hostPort = findMatchingEntry(parsed, port)
    if (!hostPort) return { mode: 'off', url: null }
    const allowFunnel = parsed.AllowFunnel ?? {}
    const isFunnel = allowFunnel[hostPort] === true
    const host = hostPort.split(':')[0]
    return { mode: isFunnel ? 'funnel' : 'serve', url: `https://${host}/` }
  } catch {
    return { mode: 'off', url: null }
  }
}

async function runTailscale(args: string[], timeoutMs = 10000): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await execFileP('tailscale', args, { timeout: timeoutMs })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const e = err as { message?: string; stderr?: string; stdout?: string }
    const errMsg = (e?.stderr || e?.stdout || e?.message || String(err)).toString()
    return { ok: false, error: errMsg }
  }
}

export async function setHttpsMode(mode: HttpsMode, port: number): Promise<
  | { ok: true; status: HttpsStatus }
  | { ok: false; error: string; funnelEnableUrl?: string }
> {
  if (mode === 'off') {
    const r = await runTailscale(['serve', 'reset'])
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, status: getHttpsStatus(port) }
  }

  if (mode === 'serve') {
    // Switching from funnel back to serve-only: reset first, then re-create
    // serve config. tailscale CLI has no direct "demote funnel to serve" verb.
    const current = getHttpsStatus(port)
    if (current.mode === 'funnel') {
      const reset = await runTailscale(['serve', 'reset'])
      if (!reset.ok) return { ok: false, error: reset.error }
    }
    const r = await runTailscale(['serve', '--bg', String(port)])
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, status: getHttpsStatus(port) }
  }

  // mode === 'funnel'
  const r = await runTailscale(['funnel', '--bg', String(port)])
  if (!r.ok) {
    // "Funnel is not enabled on your tailnet" prints a one-time admin URL the
    // operator has to visit to enable funnel for the tailnet. Surface it.
    const match = r.error.match(/https:\/\/login\.tailscale\.com\/[^\s]+/)
    return {
      ok: false,
      error: r.error.trim(),
      ...(match ? { funnelEnableUrl: match[0] } : {}),
    }
  }
  return { ok: true, status: getHttpsStatus(port) }
}

export function parsePortFromUrl(url: string, fallback: number): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    if (u.protocol === 'https:') return 443
    if (u.protocol === 'http:') return 80
  } catch {
    // ignore
  }
  return fallback
}
