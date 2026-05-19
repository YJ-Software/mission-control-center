/**
 * OpenClaw Gateway Integration
 *
 * Uses `openclaw agent` CLI to trigger isolated agent turns.
 * The webhook endpoint (POST /hooks/agent) requires gateway mode != "local",
 * so we use the CLI which works in all modes.
 */

import { existsSync, readdirSync } from 'fs'
import { execSync, execFile } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'

export function findOpenclawBin(): string {
  if (process.env.OPENCLAW_BIN) return process.env.OPENCLAW_BIN

  // Check common locations
  const candidates = [
    join(homedir(), '.npm-global', 'bin', 'openclaw'),
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  // nvm: ~/.nvm/versions/node/<version>/bin/openclaw. systemd user units
  // don't get nvm's PATH because nvm only initialises in interactive shells,
  // so a server install via `npm i -g openclaw` from a Node managed by nvm
  // is invisible to a service running with the default user PATH.
  const nvmRoot = join(homedir(), '.nvm', 'versions', 'node')
  if (existsSync(nvmRoot)) {
    try {
      for (const ver of readdirSync(nvmRoot)) {
        const p = join(nvmRoot, ver, 'bin', 'openclaw')
        if (existsSync(p)) return p
      }
    } catch { /* ignore */ }
  }

  // Linuxbrew / Homebrew on Linux.
  for (const root of ['/home/linuxbrew/.linuxbrew', join(homedir(), '.linuxbrew')]) {
    const p = join(root, 'bin', 'openclaw')
    if (existsSync(p)) return p
  }

  // Fallback: try which
  try {
    return execSync('which openclaw', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { /* ignore */ }

  return 'openclaw'
}

const OPENCLAW_BIN = findOpenclawBin()

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Read all key/value pairs from the morningReportConfig table. */
export async function getConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(morningReportConfig)
  const config: Record<string, string> = {}
  for (const row of rows) {
    config[row.key] = row.value
  }
  return config
}

// ---------------------------------------------------------------------------
// Trigger topic execution via gateway
// ---------------------------------------------------------------------------

interface TriggerOptions {
  model?: string
  timeout?: number
}

interface TriggerResult {
  success: boolean
  sessionId?: string
  error?: string
}

/**
 * Trigger execution of a single topic by sending its prompt to the OpenClaw
 * gateway via `openclaw agent` CLI.
 *
 * Instead of passing the full prompt as a CLI argument (which can exceed
 * ARG_MAX), we send a short message instructing the agent to read the
 * prompt file at the given absolute path.
 */
export async function triggerTopicExecution(
  topicId: string,
  promptPath: string,
  options?: TriggerOptions,
): Promise<TriggerResult> {
  try {
    // Verify prompt file exists
    if (!existsSync(promptPath)) {
      return { success: false, error: `Prompt file not found: ${promptPath}` }
    }

    const timeout = options?.timeout || 600
    const sessionId = `mr-${topicId}-${Date.now()}`

    // Build a message that tells the agent to read and execute the prompt file
    const message = `讀取並嚴格執行以下 prompt 檔案中的完整指令：\n\n\`${promptPath}\`\n\n請先讀取該檔案的完整內容，然後按照檔案中的所有指示執行（包括搜尋新聞、整理內容、寫入指定的輸出檔）。`

    const args = [
      '--no-color',
      'agent',
      '--session-id', sessionId,
      '--message', message,
      '--timeout', String(timeout),
      '--json',
    ]

    return new Promise<TriggerResult>((resolve) => {
      execFile(OPENCLAW_BIN, args, {
        timeout: (timeout + 30) * 1000,
        env: { ...process.env, NO_COLOR: '1' },
      }, (error, stdout, stderr) => {
        if (error) {
          const errMsg = stderr?.trim() || error.message
          resolve({ success: false, error: errMsg })
          return
        }
        // Extract JSON from stdout (may contain plugin log lines)
        let jsonStr = stdout
        const idx = stdout.indexOf('{')
        if (idx > 0) jsonStr = stdout.substring(idx)
        let result: any = {}
        try { result = JSON.parse(jsonStr) } catch { /* ok */ }
        resolve({ success: true, sessionId: result?.result?.meta?.agentMeta?.sessionId || sessionId })
      })
    })
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) }
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/** Return true if the OpenClaw gateway is reachable. */
export async function checkGatewayHealth(): Promise<boolean> {
  try {
    const rpc = (globalThis as any).__gatewayRpc
    if (typeof rpc === 'function') {
      await rpc('cron.status', {})
      return true
    }
    return false
  } catch {
    return false
  }
}
