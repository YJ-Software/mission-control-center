import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import {
  getAllObsidianConfigClean,
  getObsidianConfig,
  setMultipleObsidianConfig,
  autoDetectInstalled,
  detectVaultPaths,
} from '@/lib/second-brain/obsidian/config'
import { setVncPassword } from '@/lib/second-brain/obsidian/vnc'
import { registerObsidianVault, ensureOpenboxSetup } from '@/lib/second-brain/obsidian/installer'
import { resolveHome } from '@/lib/headless-vnc'

export async function GET() {
  try {
    const detected = autoDetectInstalled()
    // Auto-repair: ensure openbox service/config exist for existing installations
    if (detected.obsidian && detected.openbox) {
      ensureOpenboxSetup()
    }
    const config = getAllObsidianConfigClean()
    const detectedVaults = detected.obsidian ? detectVaultPaths() : []
    return NextResponse.json({ ...config, detected, detectedVaults })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    const oldVncPassword = getObsidianConfig('vnc_password')
    const oldVaultPath = getObsidianConfig('vault_path')

    // Update VNC password file if password changed
    if (body.vnc_password && body.vnc_password !== oldVncPassword) {
      try {
        setVncPassword(body.vnc_password)
      } catch {
        // x11vnc may not be installed yet during initial config
      }
    }

    setMultipleObsidianConfig(body)

    // If vault path changed, re-register and restart Obsidian
    if (body.vault_path && body.vault_path !== oldVaultPath) {
      try {
        registerObsidianVault(resolveHome(body.vault_path))
        execFileSync('systemctl', ['--user', 'restart', 'obsidian-headless.service'], { timeout: 10000 })
      } catch {
        // Obsidian may not be installed yet
      }
    }

    const config = getAllObsidianConfigClean()
    return NextResponse.json(config)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
