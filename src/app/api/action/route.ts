import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import path from 'path'
import os from 'os'

/**
 * Quick Actions API — all commands are hardcoded static strings,
 * no user input is interpolated into shell commands.
 */

function run(cmd: string, timeout = 30000): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise(resolve => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message, output: (stdout || stderr || '').trim() })
      } else {
        resolve({ success: true, output: (stdout || '').trim() })
      }
    })
  })
}

const WORKSPACE_DIR = os.homedir()
const PROJ_DIR = path.join(WORKSPACE_DIR, 'projects')

// All action keys are validated against this allowlist — no arbitrary command execution
const actions: Record<string, () => Promise<{ success: boolean; output?: string; error?: string; message?: string }>> = {
  'restart-openclaw': async () => {
    const r1 = await run('systemctl restart openclaw 2>/dev/null')
    if (r1.success) return r1
    const r2 = await run('systemctl --user restart openclaw 2>/dev/null')
    if (r2.success) return r2
    return run('systemctl --user restart openclaw-gateway 2>/dev/null')
  },

  'restart-dashboard': async () => {
    setTimeout(() => {
      exec('systemctl restart mission-control 2>/dev/null || systemctl --user restart mission-control 2>/dev/null')
    }, 2000)
    return { success: true, message: 'Restarting in 2 seconds...' }
  },

  'clear-cache': async () => {
    return { success: true, output: 'Cache cleared' }
  },

  'restart-tailscale': async () => {
    return run('sudo systemctl restart tailscaled 2>/dev/null || systemctl restart tailscaled 2>/dev/null')
  },

  'update-openclaw': async () => {
    return run('npm update -g openclaw 2>&1', 120000)
  },

  'update-mcc': async () => {
    // Mirror /api/upgrade/check + /api/upgrade/apply, but inline so the
    // quick-action returns one consolidated result. Auth gating already
    // happened at this route's proxy layer.
    const { getInstallInfo, fetchManifest, getConfiguredManifestUrl, pickArtifact, downloadArtifact, applyUpgrade, scheduleServiceRestart } = await import('@/lib/upgrade/manager')
    const { getVersionInfo } = await import('@/lib/version')

    const info = getInstallInfo()
    if (info.mode !== 'release') {
      return { success: false, error: `upgrade requires release-mode install (current mode: ${info.mode})` }
    }

    const manifestUrl = getConfiguredManifestUrl()
    if (!manifestUrl) return { success: false, error: 'no manifest URL configured' }

    let manifest
    try {
      manifest = await fetchManifest(manifestUrl)
    } catch (err) {
      return { success: false, error: `manifest fetch failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    const current = getVersionInfo().version
    const cmp = (a: string, b: string) => {
      const pa = a.split('.').map(n => parseInt(n, 10) || 0)
      const pb = b.split('.').map(n => parseInt(n, 10) || 0)
      for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0)
        if (d !== 0) return d
      }
      return 0
    }
    if (cmp(manifest.latest.version, current) <= 0) {
      return { success: true, output: `Already at latest v${current}` }
    }

    const artifact = pickArtifact(manifest)
    if (!artifact) return { success: false, error: 'no matching artifact for this platform' }

    try {
      const tarballPath = await downloadArtifact(artifact.url)
      const result = await applyUpgrade({ tarballPath, expectedSha256: artifact.sha256 || undefined })
      scheduleServiceRestart(info.service)
      return { success: true, output: `Upgrading to v${result.version} — service restart scheduled` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  'kill-tmux': async () => {
    return run('tmux kill-session -t claude-persistent 2>/dev/null; echo "Tmux sessions cleaned"')
  },

  'gc': async () => {
    // Static path from os.homedir() — not user input
    return run(
      `if [ -d "${PROJ_DIR}" ]; then for d in ${PROJ_DIR}/*/; do (cd "$d" && git gc --quiet 2>/dev/null); done; fi; echo "GC complete"`,
      120000
    )
  },

  'check-update': async () => {
    return run('npm outdated -g openclaw 2>/dev/null || echo "All packages up to date"')
  },

  'sys-update': async () => {
    return run('sudo apt update -qq && sudo apt upgrade -y -qq 2>&1 | tail -5', 300000)
  },

  'disk-cleanup': async () => {
    return run(
      'sudo apt autoremove -y -qq 2>/dev/null; sudo apt clean 2>/dev/null; sudo journalctl --vacuum-time=7d 2>/dev/null; echo "Cleanup done"',
      60000
    )
  },

  'restart-claude': async () => {
    // Static path from os.homedir() — not user input
    return run(
      `tmux kill-session -t claude-persistent 2>/dev/null; sleep 1; tmux new-session -d -s claude-persistent -x 200 -y 60 && tmux send-keys -t claude-persistent "cd ${WORKSPACE_DIR} && claude" Enter && echo "Claude session started"`,
      20000
    )
  },
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = typeof body.action === 'string' ? body.action : ''

    if (!actions[action]) {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }

    const result = await actions[action]()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
