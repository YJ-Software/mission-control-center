// src/lib/headless-vnc/sse-stream.ts
import { spawn } from 'child_process'

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

export function createSSEStream(
  commands: SSECommand[],
  opts?: {
    onBefore?: (enqueue: (event: InstallEvent) => void) => Promise<void> | void
    onAfter?: (enqueue: (event: InstallEvent) => void) => Promise<void> | void
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const enqueue = (event: InstallEvent) => {
        try { controller.enqueue(encoder.encode(sseEncode(event))) } catch {}
      }

      try {
        if (opts?.onBefore) await opts.onBefore(enqueue)

        // Env vars sudo strips by default — must be forwarded explicitly via
        // `sudo env KEY=val` so apt + needrestart stay non-interactive.
        const NON_INTERACTIVE_ENV_PAIRS = [
          'DEBIAN_FRONTEND=noninteractive',
          'NEEDRESTART_MODE=a',
          'NEEDRESTART_SUSPEND=1',
          'UCF_FORCE_CONFFOLD=1',
          'APT_LISTCHANGES_FRONTEND=none',
        ]

        for (let i = 0; i < commands.length; i++) {
          const { label, cmd, args: rawArgs, optional, env } = commands[i]
          enqueue({ type: 'progress', data: `[${i + 1}/${commands.length}] ${label}` })

          // Forward non-interactive env through sudo (strips env by default)
          const args = cmd === 'sudo'
            ? ['env', ...NON_INTERACTIVE_ENV_PAIRS, ...rawArgs]
            : rawArgs

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
        controller.close()
      }
    },
  })
}
