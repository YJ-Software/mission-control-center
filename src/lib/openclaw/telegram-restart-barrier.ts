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

function normalizeAccountId(id: string): string {
  const normalized = id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return normalized && !['__proto__', 'constructor', 'prototype'].includes(normalized) ? normalized : 'default'
}

function telegramConfig(env: NodeJS.ProcessEnv): { accountIds?: string[]; reloadOff?: boolean; modifiedAt?: number } {
  const home = env.OPENCLAW_HOME?.trim() || env.HOME || homedir()
  const profile = env.OPENCLAW_PROFILE?.trim()
  const state = env.OPENCLAW_STATE_DIR?.trim() ||
    (profile && profile.toLowerCase() !== 'default' ? `.openclaw-${profile}` : '.openclaw')
  const resolve = (file: string) => path.resolve(home, file.replace(/^~(?=\/|$)/, home))
  const file = resolve(env.OPENCLAW_CONFIG_PATH?.trim() || path.join(state, 'openclaw.json'))
  let modifiedAt: number | undefined
  try {
    modifiedAt = statSync(file).mtimeMs
    let hasInclude = false
    const config = JSON.parse(readFileSync(file, 'utf8'), (key, value) => {
      if (key === '$include') hasInclude = true
      return value
    })
    if (hasInclude || !config || typeof config !== 'object' || Array.isArray(config)) return { modifiedAt }

    const telegram = config.channels?.telegram
    const plugin = config.plugins?.entries?.telegram
    const envToken = env.TELEGRAM_BOT_TOKEN || config.env?.vars?.TELEGRAM_BOT_TOKEN || config.env?.TELEGRAM_BOT_TOKEN
    const reloadOff = config.gateway?.reload?.mode === 'off'
    if (telegram?.enabled === false || plugin?.enabled === false || !(telegram || envToken || plugin?.enabled)) {
      return { accountIds: [], reloadOff, modifiedAt }
    }

    const accounts = new Map(Object.entries(telegram?.accounts ?? {}).map(([id, account]) =>
      [normalizeAccountId(id), (account as { enabled?: boolean } | null)?.enabled !== false] as const))
    const rootCredential = Boolean(telegram?.botToken || telegram?.tokenFile)
    if (accounts.size === 0 && rootCredential && Array.isArray(config.bindings)) {
      // A legacy single-bot config can also start under explicit Telegram bindings.
      for (const binding of config.bindings) {
        const id = binding?.match?.accountId
        if (binding?.match?.channel === 'telegram' && typeof id === 'string' && id.trim() && id.trim() !== '*') {
          accounts.set(normalizeAccountId(id), true)
        }
      }
    }
    if (!accounts.has('default') && (accounts.size === 0 || rootCredential || envToken)) {
      accounts.set('default', true)
    }
    const accountIds = [...accounts].filter(([, enabled]) => enabled).map(([id]) => id)
    return { accountIds, reloadOff, modifiedAt }
  } catch {
    // An unreadable or non-JSON config can still have a live Telegram account.
    return { modifiedAt }
  }
}

function ingressSettled(stdout: string, accountIds?: string[], configWrittenAt?: number): boolean {
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
  const writtenAtUs = (configWrittenAt ?? 0) * 1_000
  const settled = (account: { start: number; ingress: number } | undefined, startAfter = 0) =>
    account !== undefined && account.start > 0 && account.start >= startAfter && account.ingress > account.start
  if (accountIds && configWrittenAt !== undefined) {
    return accountIds.every(id => settled(accounts.get(id), writtenAtUs))
  }

  // With includes or an unreadable config, the full account list is unknown.
  // Require a fresh pair when there is a recent write and keep waiting for any observed startup still in flight.
  const observed = [...accounts.values()]
  return observed.every(account => settled(account)) && observed.some(({ start }) => start >= writtenAtUs)
}

/** The channel status marks accounts running before isolated polling starts. */
export async function waitForTelegramStartup(
  unit: string, state: Record<string, string>, env: NodeJS.ProcessEnv, configWrittenAt?: number,
): Promise<void> {
  const config = telegramConfig(env)
  if (config.accountIds?.length === 0 || ['inactive', 'failed'].includes(state.ActiveState)) return
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
    ? config.modifiedAt : undefined
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
        if (ingressSettled(stdout, config.accountIds, freshStart)) {
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
