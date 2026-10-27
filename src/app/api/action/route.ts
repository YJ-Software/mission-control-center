import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { jobShellPath, startJob } from '@/lib/jobs/runner'
import type { TriggerSource } from '@/lib/jobs/types'
import { isBackupOrRestoreBusy } from '@/lib/backup/lock'
import { clearRestartPending, listLongRuns, longRunBusyBody, markRestartPending, RestartPendingError } from '@/lib/long-running'
import { checkRestartGate, parseForce, waitForInstallsPhase } from '@/lib/restart-guard'

/** 備份/還原進行中，這些動作會把它打斷（還原中途被重啟可能留下搬到一半的資料） */
const BLOCKED_DURING_BACKUP = new Set(['restart-dashboard', 'restart-openclaw', 'update-mcc', 'update-openclaw', 'reboot-system'])

/**
 * 會重啟 MCC 自己（或整台主機）的動作：MCC unit 是 KillMode=control-group，重啟會連同 apt/dpkg 等
 * 子行程一起殺掉。長時間安裝作業進行中一律 409（見 long-running.ts）。restart-openclaw 只重啟 gateway，不在此列。
 */
const BLOCKED_DURING_LONG_RUN = new Set(['restart-dashboard', 'update-mcc', 'reboot-system'])

/**
 * OpenClaw 升級期間 gateway 是刻意停著的（騰出記憶體給 updater）：這時重啟 gateway 或再開一次升級，
 * 都會讓 gateway 與 updater 同時吃記憶體，回到會把主機拖垮的情況。升級 job 結束前一律 409。
 */
const BLOCKED_DURING_OPENCLAW_UPGRADE = new Set(['restart-openclaw', 'update-openclaw'])

/** `openclaw update --yes` 的保底時限（updater 每一步自己另有時限）。throwaway 實測同版重裝約 4 分鐘、換版（10.7 → 10.8）約 14 分鐘 */
const OPENCLAW_UPDATE_TIMEOUT_MS = 45 * 60_000

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

type ActionResult = { success: boolean; output?: string; error?: string; message?: string; jobId?: string; status?: number; code?: string; warning?: string; preflight?: unknown }
type ActionHandler = (ctx: { triggeredBy: TriggerSource; force: boolean }) => Promise<ActionResult>

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

  'restart-dashboard': async ({ triggeredBy, force }) => {
    const { getVersionInfo } = await import('@/lib/version')
    const expectedVersion = (() => { try { return getVersionInfo().version } catch { return undefined } })()
    const meta = startJob({
      kind: 'restart-mcc',
      label: 'Restart Mission Control',
      triggeredBy,
      expectedVersion,
      restartingBeforeLastPhase: true,
      phases: [
        waitForInstallsPhase(force),
        {
          name: 'schedule restart (mission-control)',
          inline: async (log) => {
            markRestartPending()
            log('stdout', 'scheduling restart in 2s')
            log('system', 'this process will be replaced; log resumes after restart')
            setTimeout(() => {
              exec('systemctl restart mission-control 2>/dev/null || systemctl --user restart mission-control 2>/dev/null', (err) => {
                // 重啟成功時，這個 systemctl 會跟著 cgroup 一起被 SIGTERM（本行程的 graceful shutdown 期間 callback
                // 仍會跑）：被訊號終止 = 重啟正在進行，不是失敗。只有真的以非 0 結束才解除「即將重啟」
                if (!err) return
                if (err.signal) {
                  console.log(`[restart] restart-dashboard: 重啟已排程（systemctl 被 ${err.signal} 終止，重啟進行中）`)
                  return
                }
                clearRestartPending()
                console.warn(`[restart] restart-dashboard failed: ${err.message}; cleared restart-pending`)
              })
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

  'update-openclaw': async ({ triggeredBy, force }) => {
    // 兩項預檢同時跑，都在開 job 前：
    // - 記憶體：updater 本身要 1.5–2 GB，gateway 又佔 1.2 GB 以上，4 GB 無 swap 的主機兩者疊加會 thrash 到失去回應。
    //   升級前一律先停 gateway、升級後（不論成敗）再啟動；停掉後估計的可用記憶體仍不足就擋（409 memory-insufficient）
    // - Node：新版 OpenClaw 對 Node 有下限（10.6 起 >=24.22.1 <25 || >=26.12.1）。CLI 與 gateway 服務的 Node 都不符合
    //   （或服務的讀不到）才擋（409 node-unsupported），畫面上講清楚幾版、要幾版
    // 兩項都擋時先回記憶體（主機失去回應比 OpenClaw 拒絕升級嚴重，後者不會改動任何東西）。取不到資訊只警告不擋；
    // force（使用者看過訊息仍要試）就照跑，被略過的預檢寫進 job log
    const {
      runOpenclawNodePreflight, fetchOpenclawLatestTarget, detectOpenclawNodeRuntime, detectGatewayServiceNodeRuntime,
    } = await import('@/lib/openclaw/node-preflight')
    const {
      runOpenclawMemoryPreflight, readProcMeminfo, inspectGatewayService, stopGatewayPhase, startGatewayPhase,
      findLeftoverUpdateStageDirs,
    } = await import('@/lib/openclaw/update-memory-guard')
    const [preflight, memory] = await Promise.all([
      runOpenclawNodePreflight({
        fetchTarget: fetchOpenclawLatestTarget,
        detectCliNode: () => detectOpenclawNodeRuntime(jobShellPath()),
        detectServiceNode: () => detectGatewayServiceNodeRuntime(),
      }),
      runOpenclawMemoryPreflight({ readMeminfo: readProcMeminfo, inspectGateway: () => inspectGatewayService() }),
    ])
    if (!force) {
      if (memory.preflight.verdict === 'block') {
        return { success: false, code: 'memory-insufficient', error: memory.preflight.message, preflight: memory.preflight.details, status: 409 }
      }
      if (preflight.verdict === 'block') {
        return { success: false, code: 'node-unsupported', error: preflight.message, preflight: preflight.details, status: 409 }
      }
    }
    const notices = [
      ...memory.preflight.warnings,
      ...(memory.preflight.verdict === 'block' ? [`使用者確認後略過記憶體預檢：${memory.preflight.message}`] : []),
      ...(preflight.verdict === 'warn' ? [preflight.message] : []),
      ...(preflight.verdict === 'block' ? [`使用者確認後略過 Node 版本預檢：${preflight.message}`] : []),
    ]
    const notice = notices.length ? notices.join('\n') : undefined
    // 只停「正在跑」的 gateway；原本就停著的不動，升級後也不替使用者啟動
    const gatewayUnit = memory.gateway?.running ? memory.gateway.unit : null

    // `openclaw update --yes` runs the bundled upgrade pipeline: global npm
    // update + **plugin update sync** (which a plain `npm install -g openclaw`
    // misses, leaving externally-installed plugins like @openclaw/codex pinned
    // to their nested openclaw version) + completion refresh + doctor. We rely
    // on it instead of issuing the steps ourselves.
    // `--no-restart`：真的換版時 updater 會在自己還佔著約 1.2 GB 時就把 gateway 拉起來驗證，throwaway 實測
    // MemAvailable 因此掉到約 100 MB。gateway 改由收尾 phase 在 updater 結束、記憶體還回來之後才啟動。
    // 外層時限只是保底：updater 每一步自己有時限；卡住時 gateway 不能一直停著，逾時收掉 updater、收尾 phase 照樣啟動 gateway
    const meta = startJob({
      kind: 'upgrade-openclaw',
      label: 'Upgrade OpenClaw CLI',
      triggeredBy,
      phases: [
        ...(notice ? [{
          name: 'Upgrade preflight',
          inline: async (log: (stream: 'system', text: string) => void) => { log('system', notice); return 0 },
        }] : []),
        ...(gatewayUnit ? [stopGatewayPhase(gatewayUnit)] : []),
        gatewayUnit
          ? { name: 'openclaw update --yes --no-restart', shell: 'openclaw update --yes --no-restart 2>&1', timeoutMs: OPENCLAW_UPDATE_TIMEOUT_MS }
          : { name: 'openclaw update --yes', shell: 'openclaw update --yes 2>&1', timeoutMs: OPENCLAW_UPDATE_TIMEOUT_MS },
        ...(gatewayUnit ? [startGatewayPhase(gatewayUnit)] : []),
        {
          name: 'check leftover update files',
          alwaysRun: true,
          inline: async (log: (stream: 'system', text: string) => void) => {
            for (const dir of findLeftoverUpdateStageDirs(jobShellPath())) {
              log('system', `OpenClaw updater left a staging directory (often ~600 MB): ${dir} — not removed by MCC; \`openclaw update repair\` reconciles abandoned updates`)
            }
            return 0
          },
        },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Upgrade job started', ...(notice ? { warning: notice } : {}) }
  },

  'reboot-system': async ({ triggeredBy, force }) => {
    const { buildRebootCommand } = await import('@/lib/system-update/apt')
    // Record the request before issuing it. The reboot takes the server down,
    // so a job that waited on the command could never write its own result —
    // this job's work IS the request, and it finishes as soon as the reboot is
    // scheduled. Without it a reboot leaves no trace in the system log at all:
    // nobody can tell afterwards who restarted the host, or when.
    const meta = startJob({
      kind: 'reboot-host',
      label: 'Reboot host',
      triggeredBy,
      phases: [
        waitForInstallsPhase(force),
        {
          name: 'schedule reboot',
          inline: async (log) => {
            markRestartPending(10 * 60_000)
            log('system', 'reboot scheduled; the host goes down in a few seconds')
            // 失敗（sudo 不放行、systemctl 非 0）就立刻解除「即將重啟」；成功時主機關機，callback 不會執行
            exec(buildRebootCommand(), (err) => {
              // 被訊號終止 = 關機流程已經在殺行程，不是失敗
              if (!err || err.signal) return
              clearRestartPending()
              console.warn(`[reboot] reboot command failed: ${err.message}; cleared restart-pending`)
            })
            return 0
          },
        },
      ],
    })
    return { success: true, jobId: meta.id, message: 'Reboot scheduled' }
  },

  'update-mcc': async ({ triggeredBy, force }) => {
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

    const versionInfo = getVersionInfo()
    const currentMcc = versionInfo.mccVersion
    const currentDisplay = versionInfo.version
    const { parseMccVersion } = await import('@/lib/version')
    const latestMcc = manifest.latest.mccVersion || parseMccVersion(manifest.latest.version)
    const cmp = (a: string, b: string) => {
      const pa = a.split('.').map(n => parseInt(n, 10) || 0)
      const pb = b.split('.').map(n => parseInt(n, 10) || 0)
      for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0)
        if (d !== 0) return d
      }
      return 0
    }
    if (cmp(latestMcc, currentMcc) <= 0) {
      return { success: true, output: `Already at latest ${currentDisplay}` }
    }

    const artifact = pickArtifact(manifest)
    if (!artifact) return { success: false, error: 'no matching artifact for this platform' }

    const expectedVersion = manifest.latest.version
    const service = info.service

    const meta = startJob({
      kind: 'upgrade-mcc',
      label: `Upgrade Mission Control ${currentDisplay} → ${expectedVersion}`,
      triggeredBy,
      expectedVersion,
      restartingBeforeLastPhase: true,
      phases: [
        {
          name: `download ${expectedVersion}`,
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
        waitForInstallsPhase(force),
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

    return { success: true, jobId: meta.id, message: `Upgrading to ${expectedVersion} — service restart scheduled` }
  },

  'check-update': async () => {
    return run('npm outdated -g openclaw 2>/dev/null || echo "All packages up to date"')
  },

  'sys-update': async ({ triggeredBy }) => {
    // Phases come from buildSystemUpdatePhases: a job has no tty, so apt must
    // run noninteractive with --force-confold or a package shipping a changed
    // config file stops the upgrade on a prompt nobody can answer.
    const { buildSystemUpdatePhases } = await import('@/lib/system-update/apt')
    const meta = startJob({
      kind: 'sys-update',
      label: 'apt update + upgrade',
      triggeredBy,
      phases: buildSystemUpdatePhases(),
    })
    return { success: true, jobId: meta.id }
  },

  // 「一鍵修復」：上次 apt 被中斷（dpkg interrupted）時由通知或系統更新卡觸發。走 job runner 才有日誌；
  // dpkg-repair 在 LONG_RUNNING_JOB_KINDS 裡，執行期間同樣擋住重啟。
  'dpkg-repair': async ({ triggeredBy }) => {
    const { dpkgRepairStrictShell, DPKG_REPAIR_LABEL } = await import('@/lib/system-update/dpkg-repair')
    // 另一個 apt/dpkg（或另一次修復）正在跑時，第二個 dpkg 只會撞鎖失敗，留下一筆令人困惑的失敗 job
    const running = listLongRuns()
    if (running.length > 0) {
      const body = longRunBusyBody(running, '其他安裝作業進行中，現在修復會撞上套件管理員的鎖；請等它完成後再試')
      return { ...body, status: 409 } as ActionResult
    }
    const meta = startJob({
      kind: 'dpkg-repair',
      label: DPKG_REPAIR_LABEL,
      triggeredBy,
      phases: [{ name: 'dpkg --configure -a', shell: dpkgRepairStrictShell() }],
      // 修好就清掉通知；沒修好就重新通知（按鈕回來）
      onSettled: () => {
        void import('@/lib/system-update/dpkg-boot-check').then((m) => m.recheckDpkgAfterRepair())
      },
    })
    return { success: true, jobId: meta.id, message: 'dpkg repair started' }
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

    if (BLOCKED_DURING_BACKUP.has(action) && isBackupOrRestoreBusy()) {
      return NextResponse.json(
        { success: false, error: '備份或還原進行中，暫時無法執行此操作（重啟、升級或重開機）；請等它完成後再試' },
        { status: 409 },
      )
    }

    // 使用者在前端看過進行中的清單並二次確認後才會帶 force: true；略過互鎖並留下紀錄
    const force = parseForce(body.force)
    if (BLOCKED_DURING_LONG_RUN.has(action)) {
      const gate = checkRestartGate(force)
      if (gate.blocked) return NextResponse.json(longRunBusyBody(gate.blocked), { status: 409 })
    }

    if (BLOCKED_DURING_OPENCLAW_UPGRADE.has(action) && listLongRuns().some(r => r.kind === 'upgrade-openclaw')) {
      return NextResponse.json(
        { success: false, code: 'openclaw-upgrading', error: 'OpenClaw 升級進行中（升級期間 gateway 會暫停），請等升級完成、gateway 自動啟動後再試' },
        { status: 409 },
      )
    }

    const { status, ...result } = await actions[action]({ triggeredBy, force })
    return NextResponse.json(result, status ? { status } : undefined)
  } catch (err) {
    if (err instanceof RestartPendingError) {
      return NextResponse.json({ success: false, code: 'restart-pending', error: err.message }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
