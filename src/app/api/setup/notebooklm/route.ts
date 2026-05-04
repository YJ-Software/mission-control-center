import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

import { getServerEnv } from '@/lib/server-env'

// The original code block we want to replace (nlm's cdp.py)
const PATCH_SEARCH = `    # Check if Chrome is running with debugging
    # First, try to find an existing instance on any port in our range
    reused_existing = False
    existing_port, debugger_url = None, None
    if not clear_profile:
        existing_port, debugger_url = find_existing_nlm_chrome(profile_name=profile_name)

    if existing_port:
        port = existing_port
        reused_existing = True

    if not debugger_url and auto_launch:`

const PATCH_REPLACE = `    # Check if Chrome is running with debugging
    # First, try the requested port directly (e.g. externally managed Chrome on 9222)
    reused_existing = False
    debugger_url = get_debugger_url(port)
    if debugger_url:
        reused_existing = True

    # If not found, try to find an existing NLM-launched instance via port map
    if not debugger_url and not clear_profile:
        existing_port, debugger_url = find_existing_nlm_chrome(profile_name=profile_name)
        if existing_port:
            port = existing_port
            reused_existing = True

    if not debugger_url and auto_launch:`

async function which(cmd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000, env: getServerEnv() })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function getVersion(cmd: string, args: string[] = ['--version']): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 10000, env: getServerEnv() })
    return stdout.trim()
  } catch {
    return ''
  }
}

function findCdpPyPath(): string | null {
  // Method 1: Resolve nlm binary symlink to find uv tool install dir
  try {
    const { execFileSync } = require('child_process')
    const nlmPath = execFileSync('which', ['nlm'], { encoding: 'utf-8', timeout: 5000 }).trim()
    if (nlmPath) {
      const realPath = require('fs').realpathSync(nlmPath)
      // realPath: .../uv/tools/notebooklm-mcp-cli/bin/nlm
      const toolDir = join(realPath, '..', '..')  // .../notebooklm-mcp-cli/
      // Search lib/python*/site-packages for cdp.py
      const libDir = join(toolDir, 'lib')
      if (existsSync(libDir)) {
        const pythonDirs = require('fs').readdirSync(libDir).filter((d: string) => d.startsWith('python'))
        for (const pyDir of pythonDirs) {
          const candidate = join(libDir, pyDir, 'site-packages', 'notebooklm_tools', 'utils', 'cdp.py')
          if (existsSync(candidate)) return candidate
          // Also check older package name
          const candidate2 = join(libDir, pyDir, 'site-packages', 'nlm', 'utils', 'cdp.py')
          if (existsSync(candidate2)) return candidate2
        }
      }
    }
  } catch { /* continue to fallback */ }

  // Method 2: Check common uv tool paths directly
  const home = homedir()
  const baseDirs = [
    join(home, '.local/share/uv/tools/notebooklm-mcp-cli'),
    join(home, '.local/share/uv/tools/notebooklm-cli'),
  ]

  for (const base of baseDirs) {
    if (!existsSync(base)) continue
    const libDir = join(base, 'lib')
    if (!existsSync(libDir)) continue
    try {
      const pythonDirs = require('fs').readdirSync(libDir).filter((d: string) => d.startsWith('python'))
      for (const pyDir of pythonDirs) {
        const candidate = join(libDir, pyDir, 'site-packages', 'notebooklm_tools', 'utils', 'cdp.py')
        if (existsSync(candidate)) return candidate
      }
    } catch { /* continue */ }
  }
  return null
}

function isCdpPatched(cdpPath: string): boolean {
  try {
    const content = readFileSync(cdpPath, 'utf-8')
    return content.includes('try the requested port directly')
  } catch {
    return false
  }
}

/** Upstream nlm >= (unknown version) natively scans CDP_PORT_RANGE via
 *  find_any_existing_cdp_browser(), so our patch is not needed at all. */
function isCdpPatchNotNeeded(cdpPath: string): boolean {
  try {
    return readFileSync(cdpPath, 'utf-8').includes('find_any_existing_cdp_browser')
  } catch {
    return false
  }
}

function applyCdpPatch(cdpPath: string): { ok: boolean; message: string } {
  try {
    let content = readFileSync(cdpPath, 'utf-8')

    if (content.includes('try the requested port directly')) {
      return { ok: true, message: 'Already patched' }
    }

    // Upstream notebooklm-mcp-cli added find_any_existing_cdp_browser() which scans
    // CDP_PORT_RANGE (9222..9232) and picks up externally-managed Chrome natively.
    // If that function is present, the patch is no longer needed.
    if (content.includes('find_any_existing_cdp_browser')) {
      return { ok: true, message: 'Upstream supports external CDP natively; no patch needed' }
    }

    if (!content.includes(PATCH_SEARCH)) {
      return { ok: false, message: 'Cannot find patch target in cdp.py — version may be incompatible' }
    }

    content = content.replace(PATCH_SEARCH, PATCH_REPLACE)
    writeFileSync(cdpPath, content, 'utf-8')
    return { ok: true, message: 'Patch applied successfully' }
  } catch (err) {
    return { ok: false, message: `Patch failed: ${err}` }
  }
}

/** GET — check installation status */
export async function GET() {
  try {
    const uvPath = await which('uv')
    const nlmPath = await which('nlm')

    let uvVersion = ''
    if (uvPath) uvVersion = await getVersion('uv', ['version'])

    let nlmVersion = ''
    if (nlmPath) nlmVersion = await getVersion('nlm', ['--version'])

    const cdpPath = findCdpPyPath()
    const patched = cdpPath ? isCdpPatched(cdpPath) : false
    const notNeeded = cdpPath ? (!patched && isCdpPatchNotNeeded(cdpPath)) : false

    return NextResponse.json({
      uv: { installed: !!uvPath, path: uvPath, version: uvVersion },
      nlm: { installed: !!nlmPath, path: nlmPath, version: nlmVersion },
      patch: { cdpPath, applied: patched, notNeeded },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — install uv + nlm + patch */
export async function POST(req: Request) {
  try {
    const { action } = await req.json()
    const logs: string[] = []

    if (action === 'install') {
      // Step 1: Install uv if needed
      const uvPath = await which('uv')
      if (!uvPath) {
        logs.push('Installing uv...')
        try {
          await execFileAsync('bash', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
            timeout: 60000,
            env: { ...process.env, HOME: homedir() },
          })
          logs.push('uv installed')
        } catch (err: any) {
          return NextResponse.json({
            ok: false,
            logs: [...logs, `Failed to install uv: ${err.stderr || err.message}`],
          })
        }
      } else {
        logs.push(`uv already installed: ${uvPath}`)
      }

      // Step 2: Install nlm via uv
      const nlmPath = await which('nlm')
      if (!nlmPath) {
        logs.push('Installing notebooklm-mcp-cli...')
        try {
          // Use full path to uv in case it was just installed
          const uvBin = await which('uv') || join(homedir(), '.local/bin/uv')
          await execFileAsync(uvBin, ['tool', 'install', 'notebooklm-mcp-cli'], {
            timeout: 120000,
            env: { ...process.env, HOME: homedir(), PATH: `${join(homedir(), '.local/bin')}:${process.env.PATH}` },
          })
          logs.push('notebooklm-mcp-cli installed')
        } catch (err: any) {
          return NextResponse.json({
            ok: false,
            logs: [...logs, `Failed to install nlm: ${err.stderr || err.message}`],
          })
        }
      } else {
        logs.push(`nlm already installed: ${nlmPath}`)
      }

      // Step 3: Patch cdp.py
      logs.push('Patching cdp.py for existing Chrome CDP support...')
      const cdpPath = findCdpPyPath()
      if (!cdpPath) {
        return NextResponse.json({
          ok: false,
          logs: [...logs, 'Cannot find cdp.py — nlm may not be installed correctly'],
        })
      }

      const patchResult = applyCdpPatch(cdpPath)
      logs.push(patchResult.message)

      return NextResponse.json({ ok: patchResult.ok, logs })
    }

    if (action === 'patch') {
      const cdpPath = findCdpPyPath()
      if (!cdpPath) {
        return NextResponse.json({ ok: false, logs: ['Cannot find cdp.py'] })
      }
      const result = applyCdpPatch(cdpPath)
      return NextResponse.json({ ok: result.ok, logs: [result.message] })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
