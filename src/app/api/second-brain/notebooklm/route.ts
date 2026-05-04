import { NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'
import { getServerEnv } from '@/lib/server-env'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** GET — auth status + notebook list */
export async function GET() {
  try {
    let nlmInstalled = false
    try {
      await execFileAsync('which', ['nlm'], { timeout: 5000, env: getServerEnv() })
      nlmInstalled = true
    } catch { /* not installed */ }

    if (!nlmInstalled) {
      return NextResponse.json({ installed: false, authenticated: false })
    }

    // Check version and update availability
    let version = ''
    let updateAvailable = false
    try {
      const { stdout } = await execNlm(['--version'], { skipSync: true })
      const versionMatch = stdout.match(/version\s+([\d.]+)/)
      if (versionMatch) version = versionMatch[1]
      updateAvailable = !stdout.includes('latest version')
    } catch { /* ignore */ }

    let authenticated = false
    let authOutput = ''
    try {
      const { stdout } = await execNlm(['login', '--check'])
      authenticated = stdout.includes('valid') || stdout.includes('✓')
      authOutput = stdout.trim()
    } catch (err: any) {
      authOutput = ((err.stdout || '') + (err.stderr || '')).trim()
    }

    let notebooks: unknown[] = []
    if (authenticated) {
      try { notebooks = await execNlmJson(['notebook', 'list']) } catch { /* ignore */ }
    }

    return NextResponse.json({ installed: true, authenticated, output: authOutput, notebooks, version, updateAvailable })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — login, check, create, delete */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'login') {
      try {
        const { stdout, stderr } = await execNlm(
          ['login', '--provider', 'openclaw', '--cdp-url', 'http://127.0.0.1:9222'],
          { timeout: 60000 },
        )
        const output = (stdout || '') + (stderr || '')
        const success = output.includes('✓') || output.includes('success') || output.includes('Authenticated')
        return NextResponse.json({ ok: success, output: output.trim() })
      } catch (err: any) {
        const output = (err.stdout || '') + (err.stderr || '')
        return NextResponse.json({ ok: false, output: output.trim() })
      }
    }

    if (action === 'check') {
      try {
        const { stdout } = await execNlm(['login', '--check'])
        const authenticated = stdout.includes('valid') || stdout.includes('✓')
        return NextResponse.json({ ok: true, authenticated, output: stdout.trim() })
      } catch (err: any) {
        const output = (err.stdout || '') + (err.stderr || '')
        return NextResponse.json({ ok: true, authenticated: false, output: output.trim() })
      }
    }

    if (action === 'create') {
      const { title } = body
      if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
      try {
        const { stdout } = await execNlm(['notebook', 'create', title])
        return NextResponse.json({ ok: true, output: stdout.trim() })
      } catch (err: any) {
        return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
      }
    }

    if (action === 'delete') {
      const { notebookId } = body
      if (!notebookId) return NextResponse.json({ error: 'notebookId required' }, { status: 400 })
      try {
        const { stdout } = await execNlm(['notebook', 'delete', notebookId])
        return NextResponse.json({ ok: true, output: stdout.trim() })
      } catch (err: any) {
        return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
      }
    }

    if (action === 'upgrade') {
      try {
        const uvBin = (await execFileAsync('which', ['uv'], { timeout: 5000, env: getServerEnv() })).stdout.trim()
        const { stdout } = await execFileAsync(uvBin, ['tool', 'upgrade', 'notebooklm-mcp-cli'], {
          timeout: 120000,
          env: getServerEnv(),
        })
        return NextResponse.json({ ok: true, output: stdout.trim() })
      } catch (err: any) {
        return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
