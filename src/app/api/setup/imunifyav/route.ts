import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createSSEStream, type SSECommand } from '@/lib/headless-vnc/sse-stream'

const execFileAsync = promisify(execFile)

async function which(cmd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

const INTEGRATION_CONF_DIR = '/etc/sysconfig/imunify360'
const INTEGRATION_CONF_PATH = path.join(INTEGRATION_CONF_DIR, 'integration.conf')
const UI_PATH = '/var/www/imav'
const DEPLOY_SCRIPT_URL = 'https://repo.imunify360.cloudlinux.com/defence360/imav-deploy.sh'

// The deploy script calls apt-get under sudo — sudo strips our env, so needrestart
// pops up a whiptail dialog and blocks forever. Force non-interactive via `sudo env`.
const NONINT = 'DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 UCF_FORCE_CONFFOLD=1 APT_LISTCHANGES_FRONTEND=none'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

/** GET — check ImunifyAV installation status */
export async function GET() {
  try {
    const binPath = await which('imunify-antivirus')
    if (!binPath) {
      const confExists = fs.existsSync(INTEGRATION_CONF_PATH)
      return NextResponse.json({ installed: false, confExists })
    }

    let version = ''
    try {
      const { stdout } = await execFileAsync('sudo', ['imunify-antivirus', 'version'], {
        timeout: 10000,
      })
      version = stdout.trim()
    } catch { /* ignore */ }

    // Check if service or socket is active (ImunifyAV uses socket activation)
    let serviceActive = false
    try {
      const { stdout } = await execFileAsync(
        'systemctl', ['is-active', 'imunify-antivirus'],
        { timeout: 5000 },
      )
      serviceActive = stdout.trim() === 'active'
    } catch { /* not active */ }
    if (!serviceActive) {
      try {
        const { stdout } = await execFileAsync(
          'systemctl', ['is-active', 'imunify-antivirus.socket'],
          { timeout: 5000 },
        )
        serviceActive = stdout.trim() === 'active'
      } catch { /* not active */ }
    }

    return NextResponse.json({
      installed: true,
      version,
      serviceActive,
      confExists: fs.existsSync(INTEGRATION_CONF_PATH),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — install / uninstall / purge ImunifyAV (SSE stream) */
export async function POST(req: Request) {
  const { action } = await req.json()

  if (action === 'install') {
    const deployScript = path.join(os.tmpdir(), 'imav-deploy.sh')

    const stream = createSSEStream(
      [
        { label: 'Downloading imav-deploy.sh', cmd: 'curl', args: ['-fsSL', '-o', deployScript, DEPLOY_SCRIPT_URL] },
        { label: 'Running installer', cmd: 'bash', args: ['-c', `yes | sudo env ${NONINT} bash ${deployScript}`] },
      ],
      {
        async onBefore(enqueue) {
          // Create integration.conf dir
          try {
            await execFileAsync('sudo', ['mkdir', '-p', INTEGRATION_CONF_DIR], { timeout: 5000 })
            enqueue({ type: 'log', data: `✓ Created ${INTEGRATION_CONF_DIR}` })
          } catch {
            enqueue({ type: 'log', data: `✓ ${INTEGRATION_CONF_DIR} already exists` })
          }

          // Ensure ui_path directory exists
          try {
            await execFileAsync('sudo', ['mkdir', '-p', UI_PATH], { timeout: 5000 })
            enqueue({ type: 'log', data: `✓ Created ${UI_PATH}` })
          } catch { /* ignore */ }

          // Write minimal integration.conf
          const confContent = `[paths]\nui_path = ${UI_PATH}\n`
          const tmpConf = path.join(os.tmpdir(), 'imunifyav-integration.conf')
          fs.writeFileSync(tmpConf, confContent)
          try {
            await execFileAsync('sudo', ['cp', tmpConf, INTEGRATION_CONF_PATH], { timeout: 5000 })
            enqueue({ type: 'log', data: `✓ Written ${INTEGRATION_CONF_PATH}` })
          } finally {
            try { fs.unlinkSync(tmpConf) } catch { /* ignore */ }
          }
        },
        async onAfter(enqueue) {
          try { fs.unlinkSync(deployScript) } catch { /* ignore */ }
          const binPath = await which('imunify-antivirus')
          if (binPath) {
            enqueue({ type: 'log', data: `✓ imunify-antivirus found at ${binPath}` })
          } else {
            enqueue({ type: 'log', data: '⚠ imunify-antivirus not found in PATH after install' })
          }
        },
      },
    )

    return new Response(stream, { headers: SSE_HEADERS })
  }

  if (action === 'uninstall' || action === 'purge') {
    const deployScript = path.join(os.tmpdir(), 'imav-deploy.sh')
    const flag = action === 'purge' ? '--purge' : '--uninstall'

    const commands: SSECommand[] = [
      { label: 'Downloading imav-deploy.sh', cmd: 'curl', args: ['-fsSL', '-o', deployScript, DEPLOY_SCRIPT_URL] },
      // Use `yes | ...` to auto-answer interactive prompts (e.g. autoremove confirmation)
      { label: `Running ${action}`, cmd: 'bash', args: ['-c', `yes | sudo env ${NONINT} bash ${deployScript} ${flag}`] },
    ]

    const stream = createSSEStream(commands, {
      async onAfter() {
        try { fs.unlinkSync(deployScript) } catch { /* ignore */ }
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
