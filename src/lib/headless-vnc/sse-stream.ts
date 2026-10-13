// src/lib/headless-vnc/sse-stream.ts
import { spawn } from 'child_process'
import { registerLongRun, unregisterLongRun, updateLongRun } from '@/lib/long-running'
import { DPKG_REPAIR_ARGS, DPKG_REPAIR_LABEL, isAptCommand, isDpkgRepairCommand, withAptNonInteractive } from '@/lib/system-update/dpkg-repair'

export interface InstallEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  data: string
}

export function sseEncode(event: InstallEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export interface SSECommand {
  label: string
  cmd: string
  args: string[]
  optional?: boolean
  env?: Record<string, string>
}

/**
 * 上次 apt 被中斷（MCC 重啟、主機重開）會留下 dpkg interrupted，之後每次 apt 都失敗。
 * 在第一個會動 dpkg 的步驟前插入一次 `dpkg --configure -a`（optional：失敗只記 log、不阻擋）。
 * force：指令本身看不出會跑 apt（例如 `sudo bash 安裝腳本.sh`）時由呼叫端指定。
 */
export function withAptSelfHeal(commands: SSECommand[], force = false): SSECommand[] {
  if (commands.some((c) => isDpkgRepairCommand(c.cmd, c.args))) return commands
  let at = commands.findIndex((c) => isAptCommand(c.cmd, c.args))
  if (at < 0) {
    if (!force) return commands
    at = 0
  }
  const repair: SSECommand = { label: DPKG_REPAIR_LABEL, cmd: 'sudo', args: ['-n', ...DPKG_REPAIR_ARGS], optional: true }
  return [...commands.slice(0, at), repair, ...commands.slice(at)]
}

// Env vars sudo strips by default — must be forwarded explicitly via
// `sudo env KEY=val` so apt + needrestart stay non-interactive.
const NON_INTERACTIVE_ENV_PAIRS = [
  'DEBIAN_FRONTEND=noninteractive',
  'NEEDRESTART_MODE=a',
  'NEEDRESTART_SUSPEND=1',
  'UCF_FORCE_CONFFOLD=1',
  'APT_LISTCHANGES_FRONTEND=none',
]

/**
 * 實際 spawn 的參數：apt/dpkg 補上 -y 與 conffile 旗標；sudo 時把非互動環境變數用 `env` 帶過去。
 * sudo 自己的旗標（例如 -n）要留在 env 之前，否則會被當成 env 的參數。
 */
export function buildSpawnArgs(cmd: string, rawArgs: readonly string[]): string[] {
  const args = withAptNonInteractive(cmd, rawArgs)
  if (cmd !== 'sudo') return args
  let i = 0
  while (i < args.length && args[i].startsWith('-')) i++
  return [...args.slice(0, i), 'env', ...NON_INTERACTIVE_ENV_PAIRS, ...args.slice(i)]
}

export function createSSEStream(
  inputCommands: SSECommand[],
  opts?: {
    onBefore?: (enqueue: (event: InstallEvent) => void) => Promise<void> | void
    onAfter?: (enqueue: (event: InstallEvent) => void) => Promise<void> | void
    /** 登記為長時間作業時的名稱（重啟被 409 時顯示給操作者）；未給就用第一步的 label */
    name?: string
    /** 指令裡看不出 apt、但實際會跑 apt 的流程（例如第三方安裝腳本）設 true */
    aptSelfHeal?: boolean
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const commands = withAptSelfHeal(inputCommands, opts?.aptSelfHeal)
  const runName = opts?.name ?? inputCommands[0]?.label ?? 'setup'

  return new ReadableStream({
    async start(controller) {
      const enqueue = (event: InstallEvent) => {
        try { controller.enqueue(encoder.encode(sseEncode(event))) } catch {}
      }

      // 整段串流（含 onBefore/onAfter）都登記為長時間作業：MCC 自己的重啟路徑看到就 409。
      // 不只登記單一 spawn，因為兩步之間被重啟一樣會讓安裝停在一半。
      // MCC 即將重啟時登記會丟 RestartPendingError，在 catch 裡變成串流的 error 事件
      let longRunId: number | null = null
      try {
        longRunId = registerLongRun(runName)
        const runId = longRunId
        if (opts?.onBefore) await opts.onBefore(enqueue)

        for (let i = 0; i < commands.length; i++) {
          const { label, cmd, args: rawArgs, optional, env } = commands[i]
          enqueue({ type: 'progress', data: `[${i + 1}/${commands.length}] ${label}` })
          updateLongRun(runId, { step: label })

          const args = buildSpawnArgs(cmd, rawArgs)

          try {
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(cmd, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                  ...process.env,
                  DEBIAN_FRONTEND: 'noninteractive',
                  NEEDRESTART_MODE: 'a',
                  NEEDRESTART_SUSPEND: '1',
                  UCF_FORCE_CONFFOLD: '1',
                  APT_LISTCHANGES_FRONTEND: 'none',
                  ...env,
                },
              })
              updateLongRun(runId, { pid: proc.pid ?? null })
              // exit 時就清掉 PID（close 可能因孫行程握著 stdout 延後很久）：PID 只在子行程活著時存在，
              // 死 PID 清理才不會把仍在進行的串流整筆註銷；登記項本身留到串流結束才註銷
              proc.on('exit', () => updateLongRun(runId, { pid: null }))
              proc.stdout?.on('data', (chunk: Buffer) => {
                for (const line of chunk.toString().split('\n').filter(Boolean)) {
                  enqueue({ type: 'log', data: line })
                }
              })
              proc.stderr?.on('data', (chunk: Buffer) => {
                for (const line of chunk.toString().split('\n').filter(Boolean)) {
                  enqueue({ type: 'log', data: `[stderr] ${line}` })
                }
              })
              proc.on('close', (code) => {
                updateLongRun(runId, { pid: null })
                if (code === 0) resolve()
                else reject(new Error(`Command failed with exit code ${code}`))
              })
              proc.on('error', reject)
            })
          } catch (err: any) {
            if (optional) {
              enqueue({ type: 'log', data: `↑ Optional step failed: ${err.message}` })
            } else {
              throw err
            }
          }
        }

        if (opts?.onAfter) await opts.onAfter(enqueue)

        enqueue({ type: 'done', data: 'Installation complete' })
        // Give the browser time to read the done event before closing
        await new Promise(r => setTimeout(r, 500))
      } catch (err: any) {
        enqueue({ type: 'error', data: err.message ?? String(err) })
        await new Promise(r => setTimeout(r, 500))
      } finally {
        if (longRunId !== null) unregisterLongRun(longRunId)
        controller.close()
      }
    },
  })
}
