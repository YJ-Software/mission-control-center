import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function which(cmd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function getTailscaleStatus(): Promise<Record<string, any> | null> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: 10000,
    })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** GET — check tailscale installation and connection status */
export async function GET() {
  try {
    const tsPath = await which('tailscale')
    if (!tsPath) {
      return NextResponse.json({ installed: false })
    }

    let version = ''
    try {
      const { stdout } = await execFileAsync('tailscale', ['version'], { timeout: 5000 })
      version = stdout.trim().split('\n')[0]
    } catch { /* ignore */ }

    const status = await getTailscaleStatus()
    if (!status) {
      return NextResponse.json({ installed: true, version, connected: false })
    }

    const backendState = status.BackendState ?? ''
    const connected = backendState === 'Running'
    const self = status.Self ?? {}

    return NextResponse.json({
      installed: true,
      version,
      connected,
      backendState,
      hostname: self.HostName ?? '',
      dnsName: self.DNSName ?? '',
      tailscaleIp: self.TailscaleIPs?.[0] ?? '',
      os: self.OS ?? '',
      online: self.Online ?? false,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — tailscale up / down */
export async function POST(req: Request) {
  try {
    const { action } = await req.json()

    if (action === 'up') {
      // Run tailscale up. If not authenticated, it returns an auth URL.
      // Use --json flag to get structured output when possible.
      try {
        const { stdout, stderr } = await execFileAsync(
          'sudo', ['tailscale', 'up', '--reset'],
          { timeout: 30000, encoding: 'utf-8' },
        )
        const output = (stdout || '') + (stderr || '')

        // Check if auth URL is in the output
        const urlMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/)
        if (urlMatch) {
          return NextResponse.json({ ok: true, authUrl: urlMatch[0], output: output.trim() })
        }

        return NextResponse.json({ ok: true, output: output.trim() })
      } catch (err: any) {
        const output = (err.stdout || '') + (err.stderr || '')
        // tailscale up may "fail" but still output the auth URL
        const urlMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/)
        if (urlMatch) {
          return NextResponse.json({ ok: true, authUrl: urlMatch[0], output: output.trim() })
        }
        return NextResponse.json({ ok: false, output: output.trim() || err.message })
      }
    }

    if (action === 'down') {
      try {
        const { stdout } = await execFileAsync(
          'sudo', ['tailscale', 'down'],
          { timeout: 10000, encoding: 'utf-8' },
        )
        return NextResponse.json({ ok: true, output: stdout.trim() })
      } catch (err: any) {
        return NextResponse.json({ ok: false, output: err.stderr || err.message })
      }
    }

    if (action === 'logout') {
      try {
        const { stdout } = await execFileAsync(
          'sudo', ['tailscale', 'logout'],
          { timeout: 10000, encoding: 'utf-8' },
        )
        return NextResponse.json({ ok: true, output: stdout.trim() })
      } catch (err: any) {
        return NextResponse.json({ ok: false, output: err.stderr || err.message })
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
