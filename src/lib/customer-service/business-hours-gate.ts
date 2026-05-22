/**
 * Server-side orchestration for the openclaw-business-hours-gate plugin.
 *
 * The plugin source lives at:
 *   <repo>/deploy/plugins/openclaw-business-hours-gate
 *
 * Install flow uses `openclaw plugins install -l <abs-path>` (symlink) so the
 * dashboard ships the plugin source and a single click installs it without
 * copying to ~/.openclaw/plugins. Uninstall removes the plugin and config.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

export const PLUGIN_ID = 'business-hours-gate'

export const PLUGIN_SOURCE_DIR = resolve(
  process.cwd(),
  'deploy',
  'plugins',
  'openclaw-business-hours-gate',
)

export const ID_INJECTOR_PLUGIN_ID = 'customer-id-injector'
export const ID_INJECTOR_SOURCE_DIR = resolve(
  process.cwd(),
  'deploy',
  'plugins',
  'openclaw-customer-id-injector',
)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface ScheduleWindow {
  days: Day[]
  start: string
  end: string
}

export interface GateConfig {
  schedule: {
    timezone: string
    windows: ScheduleWindow[]
  }
  replyText: string
  channels: string[]
  pauseAi: boolean
}

export interface GateStatus {
  installed: boolean
  enabled: boolean
  pluginSourceDir: string
  config: GateConfig
  idInjector: {
    installed: boolean
    enabled: boolean
    sourceDir: string
  }
}

export const DEFAULT_CONFIG: GateConfig = {
  schedule: {
    timezone: 'Asia/Taipei',
    windows: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' },
    ],
  },
  replyText: '',
  channels: [],
  pauseAi: false,
}

function readOpenclawConfig(): Record<string, any> {
  if (!existsSync(OPENCLAW_CONFIG)) return {}
  return JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
}

function writeOpenclawConfig(config: Record<string, any>): void {
  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8')
}

async function runOpenclaw(args: string[], timeoutMs = 30000): Promise<string> {
  const result = await execFileAsync('openclaw', args, {
    timeout: timeoutMs,
    encoding: 'utf-8',
    env: getServerEnv(),
  })
  return (result.stdout || '') + (result.stderr || '')
}

export async function getStatus(): Promise<GateStatus> {
  const config = readOpenclawConfig()
  const entry = config?.plugins?.entries?.[PLUGIN_ID]
  const enabled = Boolean(entry?.enabled)
  const injectorEntry = config?.plugins?.entries?.[ID_INJECTOR_PLUGIN_ID]
  const injectorEnabled = Boolean(injectorEntry?.enabled)

  let installed = false
  let injectorInstalled = false
  try {
    const out = await runOpenclaw(['plugins', 'list', '--json'], 10000)
    const parsed = JSON.parse(out.trim())
    const list: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.plugins)
        ? parsed.plugins
        : []
    installed = list.some((p: any) => p?.id === PLUGIN_ID || p?.name === PLUGIN_ID)
    injectorInstalled = list.some((p: any) => p?.id === ID_INJECTOR_PLUGIN_ID || p?.name === ID_INJECTOR_PLUGIN_ID)
  } catch {
    installed = enabled
    injectorInstalled = injectorEnabled
  }

  return {
    installed,
    enabled,
    pluginSourceDir: PLUGIN_SOURCE_DIR,
    config: mergeConfig(entry?.config),
    idInjector: {
      installed: injectorInstalled,
      enabled: injectorEnabled,
      sourceDir: ID_INJECTOR_SOURCE_DIR,
    },
  }
}

export function mergeConfig(raw: unknown): GateConfig {
  const cfg = (raw ?? {}) as Partial<GateConfig>
  return {
    schedule: {
      timezone: cfg.schedule?.timezone ?? DEFAULT_CONFIG.schedule.timezone,
      windows: Array.isArray(cfg.schedule?.windows) && cfg.schedule!.windows.length > 0
        ? cfg.schedule!.windows.map(normalizeWindow)
        : DEFAULT_CONFIG.schedule.windows,
    },
    replyText: typeof cfg.replyText === 'string' ? cfg.replyText : DEFAULT_CONFIG.replyText,
    channels: Array.isArray(cfg.channels) ? cfg.channels.filter((c) => typeof c === 'string') : DEFAULT_CONFIG.channels,
    pauseAi: typeof cfg.pauseAi === 'boolean' ? cfg.pauseAi : DEFAULT_CONFIG.pauseAi,
  }
}

const VALID_DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function normalizeWindow(win: any): ScheduleWindow {
  const days: Day[] = Array.isArray(win?.days)
    ? win.days.filter((d: any): d is Day => VALID_DAYS.includes(d))
    : []
  return {
    days,
    start: typeof win?.start === 'string' ? win.start : '09:00',
    end: typeof win?.end === 'string' ? win.end : '18:00',
  }
}

export async function installPlugin(): Promise<{ output: string }> {
  if (!existsSync(PLUGIN_SOURCE_DIR)) {
    throw new Error(`Plugin source not found at ${PLUGIN_SOURCE_DIR}`)
  }
  let output = ''
  try {
    output += await runOpenclaw(['plugins', 'install', '-l', PLUGIN_SOURCE_DIR], 60000)
  } catch (err: any) {
    const stderr = err?.stderr ?? ''
    if (!/already installed/i.test(stderr) && !/already exists/i.test(stderr)) {
      throw new Error(stderr || err?.message || 'plugin install failed')
    }
    output += stderr
  }

  try {
    output += '\n' + (await runOpenclaw(['plugins', 'enable', PLUGIN_ID], 30000))
  } catch (err: any) {
    output += '\n' + (err?.stderr ?? err?.message ?? '')
  }

  // Ensure the customer-id-injector plugin is installed + enabled. Without it,
  // mem0/wiki user_id correctness depends on the LLM remembering to pass the
  // right value (~95% reliable). With it, every customer-memory tool call has
  // user_id force-overridden from the LINE session key (100% deterministic).
  try {
    if (existsSync(ID_INJECTOR_SOURCE_DIR)) {
      try {
        output += '\n[id-injector] ' + (await runOpenclaw(['plugins', 'install', '-l', ID_INJECTOR_SOURCE_DIR], 60000)).trim()
      } catch (err: any) {
        const stderr = err?.stderr ?? ''
        if (!/already installed/i.test(stderr) && !/already exists/i.test(stderr)) {
          output += '\n[id-injector] WARN: install failed: ' + (stderr || err?.message)
        } else {
          output += '\n[id-injector] already installed'
        }
      }
      try {
        output += '\n[id-injector] ' + (await runOpenclaw(['plugins', 'enable', ID_INJECTOR_PLUGIN_ID], 30000)).trim()
      } catch (err: any) {
        output += '\n[id-injector] WARN: enable failed: ' + (err?.stderr ?? err?.message ?? '')
      }
    } else {
      output += '\n[id-injector] WARN: source dir missing at ' + ID_INJECTOR_SOURCE_DIR
    }
  } catch (err: any) {
    output += '\n[id-injector] WARN: ' + (err?.message ?? String(err))
  }

  return { output }
}

export async function uninstallPlugin(): Promise<{ output: string }> {
  let output = ''

  try {
    output += await runOpenclaw(['plugins', 'disable', PLUGIN_ID], 15000)
  } catch (err: any) {
    output += err?.stderr ?? ''
  }

  try {
    output += '\n' + (await runOpenclaw(['plugins', 'remove', PLUGIN_ID], 30000))
  } catch (err: any) {
    output += '\n' + (err?.stderr ?? err?.message ?? '')
  }

  const config = readOpenclawConfig()
  if (config?.plugins?.entries && PLUGIN_ID in config.plugins.entries) {
    delete config.plugins.entries[PLUGIN_ID]
    writeOpenclawConfig(config)
  }

  return { output }
}

export function saveConfig(input: GateConfig): GateConfig {
  const merged = mergeConfig(input)
  const config = readOpenclawConfig()
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.entries) config.plugins.entries = {}
  const existing = (config.plugins.entries[PLUGIN_ID] ?? {}) as Record<string, any>
  config.plugins.entries[PLUGIN_ID] = {
    ...existing,
    enabled: existing.enabled !== false,
    config: merged,
  }
  writeOpenclawConfig(config)
  return merged
}

export async function restartGateway(): Promise<string> {
  try {
    return await runOpenclaw(['gateway', 'restart'], 60000)
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}
