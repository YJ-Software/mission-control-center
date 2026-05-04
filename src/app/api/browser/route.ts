import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import {
  getAllBrowserConfigClean,
  getBrowserConfig,
  setMultipleBrowserConfig,
  autoDetectInstalled,
} from '@/lib/browser/config'
import { setVncPassword, writeSystemdUnits } from '@/lib/headless-vnc'
import { buildVncStackConfig } from '@/lib/browser/installer'
import path from 'path'
import os from 'os'

export async function GET() {
  try {
    const detected = autoDetectInstalled()
    const config = getAllBrowserConfigClean()
    return NextResponse.json({ ...config, detected })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    const oldVncPassword = getBrowserConfig('vnc_password')

    // Update VNC password file if password changed
    if (body.vnc_password && body.vnc_password !== oldVncPassword) {
      const passwdFile = path.join(os.homedir(), '.vnc', 'passwd-chrome')
      try {
        setVncPassword(body.vnc_password, passwdFile)
      } catch {
        // x11vnc may not be installed yet during initial config
      }
    }

    setMultipleBrowserConfig(body)

    // Regenerate systemd units with updated config (e.g. new CDP port, display, resolution)
    try {
      const vncConfig = buildVncStackConfig()
      writeSystemdUnits(vncConfig)
      execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 })
    } catch {
      // Non-fatal: units may not exist yet during initial setup
    }

    const config = getAllBrowserConfigClean()
    return NextResponse.json(config)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
