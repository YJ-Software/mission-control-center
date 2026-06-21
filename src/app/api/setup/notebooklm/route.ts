import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

import { getServerEnv } from '@/lib/server-env'
import { findCdpPyPath, isCdpPatched, isCdpPatchNotNeeded, applyCdpPatch } from '@/lib/second-brain/notebooklm/cdp-patch'

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
          // --force overwrites a stale `notebooklm-mcp` executable left over
          // from a prior incomplete install. Without it, `uv tool install`
          // bails with "Executable already exists" and the whole install
          // step fails.
          // notebooklm-mcp-cli pulls a large dependency tree (uvicorn, starlette,
          // sse-starlette, …). On a fresh box with a cold uv cache the first
          // install can exceed 2 min, so 120s was too tight and flaked the
          // setup. 5 min matches the UI/E2E INSTALL_TIMEOUT.
          await execFileAsync(uvBin, ['tool', 'install', '--force', 'notebooklm-mcp-cli'], {
            timeout: 300000,
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
