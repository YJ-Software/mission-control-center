import { NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'
import { getServerEnv } from '@/lib/server-env'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { startJob } from '@/lib/jobs/runner'
import { readAllJobs } from '@/lib/jobs/store'
import { findCdpPyPath, applyCdpPatch } from '@/lib/second-brain/notebooklm/cdp-patch'

const execFileAsync = promisify(execFile)

/** True if an nlm upgrade job is currently running. */
async function nlmUpgradeRunning(): Promise<boolean> {
  try {
    const jobs = await readAllJobs()
    return jobs.some(j => j.kind === 'upgrade-nlm' && (j.status === 'running' || j.status === 'restarting'))
  } catch {
    return false
  }
}

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

    const upgradeInProgress = await nlmUpgradeRunning()

    return NextResponse.json({ installed: true, authenticated, output: authOutput, notebooks, version, updateAvailable, upgradeInProgress })
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
      // Don't stack concurrent upgrades — return the running one's id instead.
      if (await nlmUpgradeRunning()) {
        const jobs = await readAllJobs()
        const running = jobs.find(j => j.kind === 'upgrade-nlm' && (j.status === 'running' || j.status === 'restarting'))
        return NextResponse.json({ ok: true, jobId: running?.id, alreadyRunning: true })
      }

      // Run the upgrade as a tracked job so it shows up on the System Log page.
      const triggeredBy = body.triggeredBy === 'auto' ? 'api' : (body.triggeredBy || 'settings-card')
      const job = startJob({
        kind: 'upgrade-nlm',
        label: 'NotebookLM CLI 升級（notebooklm-mcp-cli）',
        triggeredBy,
        phases: [
          {
            name: 'uv tool upgrade notebooklm-mcp-cli',
            shell: 'uv tool upgrade notebooklm-mcp-cli',
          },
          {
            name: '重新套用 cdp.py patch',
            inline: async (log) => {
              const cdpPath = findCdpPyPath()
              if (!cdpPath) {
                log('stderr', 'Cannot find cdp.py — skipping patch')
                return 0
              }
              const result = applyCdpPatch(cdpPath)
              log(result.ok ? 'stdout' : 'stderr', result.message)
              return result.ok ? 0 : 1
            },
            allowFailure: true,
          },
        ],
      })
      return NextResponse.json({ ok: true, jobId: job.id })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
