import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { showGatewayUnit } from './gateway-systemd'

const execFileAsync = promisify(execFile)
const waitMs = 20_000
const pollMs = 500
export const telegramBarrierProperties = ['MainPID', 'ExecMainStartTimestamp', 'InvocationID']

function telegramConfig(env: NodeJS.ProcessEnv): { enabled: boolean; reloadOff?: boolean; modifiedAt?: number } {
  const home = env.OPENCLAW_HOME?.trim() || env.HOME || homedir()
  const profile = env.OPENCLAW_PROFILE?.trim()
  const state = env.OPENCLAW_STATE_DIR?.trim() ||
    (profile && profile.toLowerCase() !== 'default' ? `.openclaw-${profile}` : '.openclaw')
  const resolve = (file: string) => path.resolve(home, file.replace(/^~(?=\/|$)/, home))
  const file = resolve(env.OPENCLAW_CONFIG_PATH?.trim() || path.join(state, 'openclaw.json'))
  try {
    const raw = readFileSync(file, 'utf8')
    if (!raw.includes('"$include"')) {
      const config = JSON.parse(raw)
      const telegram = config.channels?.telegram
      return {
        enabled: telegram?.enabled !== false && config.plugins?.entries?.telegram?.enabled !== false &&
          Boolean(telegram || env.TELEGRAM_BOT_TOKEN || config.plugins?.entries?.telegram?.enabled),
        reloadOff: config.gateway?.reload?.mode === 'off',
        modifiedAt: statSync(file).mtimeMs,
      }
    }
  } catch {
    // An unreadable or non-JSON config can still have a live Telegram account.
  }
  return { enabled: true }
}

function ingressSettled(stdout: string, configWrittenAt?: number): boolean {
  const accounts = new Map<string, { start: number; ingress: number }>()
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue
    const { MESSAGE, __REALTIME_TIMESTAMP } = JSON.parse(line)
    if (typeof MESSAGE !== 'string') continue
    const start = /\[telegram\]\s*\[([^\]]+)\] starting provider\b/.exec(MESSAGE)
    const ingress = /\[telegram\]\s*\[diag\] isolated polling ingress started account=(\S+)/.exec(MESSAGE)
    const id = start?.[1] ?? ingress?.[1]
    const timestamp = Number(__REALTIME_TIMESTAMP)
    if (!id || !Number.isFinite(timestamp)) continue
    const account = accounts.get(id) ?? { start: 0, ingress: 0 }
    if (start) account.start = Math.max(account.start, timestamp)
    if (ingress) account.ingress = Math.max(account.ingress, timestamp)
    accounts.set(id, account)
  }
  const observed = [...accounts.values()]
  return observed.length > 0 && observed.every(({ start, ingress }) => start > 0 && ingress > start) &&
    (configWrittenAt === undefined || observed.some(({ start }) => start >= configWrittenAt * 1_000))
}

/** The channel status marks accounts running before isolated polling starts. */
export async function waitForTelegramStartup(
  unit: string, state: Record<string, string>, env: NodeJS.ProcessEnv, configWrittenAt?: number,
): Promise<void> {
  const config = telegramConfig(env)
  if (!config.enabled || ['inactive', 'failed'].includes(state.ActiveState)) return
  const warn = (reason: string) => console.warn(`[OpenClawRestart] Telegram startup barrier ${reason}; proceeding with restart`)
  if (state.LoadState !== 'loaded') {
    warn('could not identify the gateway unit')
    return
  }

  const now = Date.now()
  const deadline = now + waitMs
  // Retain events from before the write so an in-flight startup cannot be hidden
  // by the write timestamp. For callers without an explicit write time, also
  // guard a recent write to the gateway's config that may still be reloading.
  const recentWrite = config.modifiedAt !== undefined && config.modifiedAt >= now - waitMs
    ? Math.floor(config.modifiedAt) : undefined
  const freshStart = config.reloadOff ? undefined : configWrittenAt ?? recentWrite
  try {
    while (Date.now() < deadline) {
      const pid = state.MainPID
      if (/^[1-9]\d*$/.test(pid ?? '')) {
        const startedAt = Date.parse(state.ExecMainStartTimestamp)
        const { stdout } = await execFileAsync('journalctl', [
          '--user', '-u', unit, '-b', '--no-pager', '-o', 'json', '--output-fields=MESSAGE',
          '--grep=starting provider|isolated polling ingress started',
          ...(Number.isFinite(startedAt) ? [`--since=@${Math.floor(startedAt / 1_000)}`] : []),
          `_PID=${pid}`, ...(state.InvocationID ? [`_SYSTEMD_INVOCATION_ID=${state.InvocationID}`] : []),
        ], { env, timeout: Math.max(1, Math.min(2_000, deadline - Date.now())), encoding: 'utf8' }).catch(error => {
          // journalctl --grep exits 1 without output when no entries match.
          if (error.code === 1 && !error.stdout && !error.stderr) return { stdout: '' }
          throw error
        })
        if (ingressSettled(stdout, freshStart)) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          const current = await showGatewayUnit(unit, true, ['MainPID', 'InvocationID'], env, remaining)
          if (current.MainPID === pid && current.InvocationID === state.InvocationID) return
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(pollMs, deadline - Date.now()))))
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      state = await showGatewayUnit(unit, true, ['LoadState', 'ActiveState', ...telegramBarrierProperties], env, remaining)
      if (['inactive', 'failed'].includes(state.ActiveState)) return
      if (state.LoadState !== 'loaded') {
        warn('lost visibility of the gateway unit')
        return
      }
    }
  } catch {
    warn('could not read gateway journal events')
    return
  }
  warn('timed out after 20s')
}
