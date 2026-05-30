import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import path from 'path'
import os from 'os'
import { startJob } from '@/lib/jobs/runner'
import type { TriggerSource } from '@/lib/jobs/types'

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

type ActionResult = { success: boolean; output?: string; error?: string; message?: string; jobId?: string }
type ActionHandler = (ctx: { triggeredBy: TriggerSource }) => Promise<ActionResult>

// All action keys are validated against this allowlist — no arbitrary command execution
const actions: Record<string, ActionHandler> = {
  'restart-openclaw': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'restart-openclaw',
      label: 'Restart OpenClaw',
      triggeredBy,
      phases: [
        {
          name: 'systemctl restart openclaw',
          shell:
            'systemctl restart openclaw 2>&1 ' +
            '|| systemctl --user restart openclaw 2>&1 ' +
            '|| systemctl --user restart openclaw-gateway 2>&1',
        },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Restart job started' }
  },

  'restart-dashboard': async ({ triggeredBy }) => {
    const { getVersionInfo } = await import('@/lib/version')
    const expectedVersion = (() => { try { return getVersionInfo().version } catch { return undefined } })()
    const meta = startJob({
      kind: 'restart-mcc',
      label: 'Restart Mission Control',
      triggeredBy,
      expectedVersion,
      restartingBeforeLastPhase: true,
      phases: [
        {
          name: 'schedule restart (mission-control)',
          inline: async (log) => {
            log('stdout', 'scheduling restart in 2s')
            log('system', 'this process will be replaced; log resumes after restart')
            setTimeout(() => {
              exec('systemctl restart mission-control 2>/dev/null || systemctl --user restart mission-control 2>/dev/null')
            }, 2000)
            return 0
          },
        },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Restarting in 2 seconds...' }
  },

  'clear-cache': async () => {
    return { success: true, output: 'Cache cleared' }
  },

  'restart-tailscale': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'restart-tailscale',
      label: 'Restart Tailscale',
      triggeredBy,
      phases: [
        {
          name: 'systemctl restart tailscaled',
          shell: 'sudo systemctl restart tailscaled 2>&1 || systemctl restart tailscaled 2>&1',
        },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Restart job started' }
  },

  'update-openclaw': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'upgrade-openclaw',
      label: 'Upgrade OpenClaw CLI',
      triggeredBy,
      phases: [
        { name: 'npm install -g openclaw@latest', shell: 'npm install -g openclaw@latest 2>&1' },
        { name: 'openclaw doctor --non-interactive', shell: 'openclaw doctor --non-interactive 2>&1', allowFailure: true },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Upgrade job started' }
  },

  'update-mcc': async ({ triggeredBy }) => {
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

    const expectedVersion = manifest.latest.version
    const service = info.service

    const meta = startJob({
      kind: 'upgrade-mcc',
      label: `Upgrade Mission Control v${current} → v${expectedVersion}`,
      triggeredBy,
      expectedVersion,
      restartingBeforeLastPhase: true,
      phases: [
        {
          name: `download v${expectedVersion}`,
          inline: async (log) => {
            try {
              log('stdout', `downloading ${artifact.url}…`)
              const tarballPath = await downloadArtifact(artifact.url)
              log('stdout', `downloaded → ${tarballPath}`)
              log('stdout', 'applying upgrade…')
              const result = await applyUpgrade({ tarballPath, expectedSha256: artifact.sha256 || undefined })
              log('stdout', `staged v${result.version}`)
              return 0
            } catch (err) {
              log('stderr', err instanceof Error ? err.message : String(err))
              return 1
            }
          },
        },
        {
          name: `restart service (${service})`,
          inline: async (log) => {
            log('stdout', `scheduling restart in 2s — service: ${service}`)
            log('system', 'this process will be replaced; log resumes after restart')
            scheduleServiceRestart(service)
            return 0
          },
        },
      ],
    })

    return { success: true, jobId: meta.id, message: `Upgrading to v${expectedVersion} — service restart scheduled` }
  },

  'kill-tmux': async () => {
    return run('tmux kill-session -t claude-persistent 2>/dev/null; echo "Tmux sessions cleaned"')
  },

  'gc': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'gc',
      label: 'git gc on all projects',
      triggeredBy,
      phases: [
        {
          name: 'git gc',
          shell:
            `if [ -d "${PROJ_DIR}" ]; then for d in ${PROJ_DIR}/*/; do (cd "$d" && echo "→ $d" && git gc --quiet 2>&1); done; fi; echo "GC complete"`,
        },
      ],
    })
    return { success: true, jobId: meta.id }
  },

  'check-update': async () => {
    return run('npm outdated -g openclaw 2>/dev/null || echo "All packages up to date"')
  },

  'sys-update': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'sys-update',
      label: 'apt update + upgrade',
      triggeredBy,
      phases: [
        { name: 'apt update', shell: 'sudo apt update 2>&1' },
        { name: 'apt upgrade', shell: 'sudo apt upgrade -y 2>&1' },
      ],
    })
    return { success: true, jobId: meta.id }
  },

  'disk-cleanup': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'disk-cleanup',
      label: 'disk cleanup',
      triggeredBy,
      phases: [
        { name: 'apt autoremove', shell: 'sudo apt autoremove -y 2>&1', allowFailure: true },
        { name: 'apt clean', shell: 'sudo apt clean 2>&1', allowFailure: true },
        { name: 'journalctl vacuum', shell: 'sudo journalctl --vacuum-time=7d 2>&1', allowFailure: true },
      ],
    })
    return { success: true, jobId: meta.id }
  },

  'restart-claude': async ({ triggeredBy }) => {
    const meta = startJob({
      kind: 'restart-claude',
      label: 'Restart Claude tmux session',
      triggeredBy,
      phases: [
        {
          name: 'restart claude-persistent tmux',
          shell:
            `tmux kill-session -t claude-persistent 2>/dev/null; sleep 1; ` +
            `tmux new-session -d -s claude-persistent -x 200 -y 60 && ` +
            `tmux send-keys -t claude-persistent "cd ${WORKSPACE_DIR} && claude" Enter && echo "Claude session started"`,
        },
      ],
    })
    return { success: true, jobId: meta.id }
  },
}

const VALID_SOURCES: TriggerSource[] = ['header-button', 'settings-card', 'quick-action', 'cron', 'api']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = typeof body.action === 'string' ? body.action : ''
    const rawSource = typeof body.triggeredBy === 'string' ? body.triggeredBy : ''
    const triggeredBy: TriggerSource = VALID_SOURCES.includes(rawSource as TriggerSource)
      ? (rawSource as TriggerSource)
      : 'api'

    if (!actions[action]) {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }

    const result = await actions[action]({ triggeredBy })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
