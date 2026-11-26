import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { capabilitiesFor } from '../agent-runtime/capabilities'

const execFileAsync = promisify(execFile)
export const OPENCLAW_GATEWAY_UNIT = capabilitiesFor('openclaw').service.userUnit
export const LEGACY_OPENCLAW_GATEWAY_UNIT = 'openclaw.service'
const COMMAND_GRACE_MS = 5_000
/** MCC caps each gateway command (stop + start together) and readiness observer at 15 minutes. */
export const MAX_GATEWAY_WAIT_MS = 15 * 60_000

export function gatewayUserUnits(env: Record<string, string | undefined> = process.env): string[] {
  const override = env.OPENCLAW_SYSTEMD_UNIT?.trim()
  if (override) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9@._-]*$/.test(override)) return []
    return [override.endsWith('.service') ? override : `${override}.service`]
  }
  const profile = env.OPENCLAW_PROFILE?.trim()
  if (!profile || profile.toLowerCase() === 'default') {
    return [OPENCLAW_GATEWAY_UNIT, LEGACY_OPENCLAW_GATEWAY_UNIT]
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(profile)) return []
  const units = [`${OPENCLAW_GATEWAY_UNIT.slice(0, -8)}-${profile}.service`]
  if (profile !== 'node' && profile !== 'gateway' && !profile.startsWith('gateway-')) {
    units.push(`openclaw-${profile}.service`)
  }
  return units
}

/** Unit-file paths shared by the runtime status monitor and Node preflight. */
export function gatewayUnitCandidates(env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  return gatewayUserUnits(env).map(name => path.join(configHome, 'systemd', 'user', name))
}

export function parseSystemctlShow(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const timeUnits: Record<string, number> = {
  w: 604_800_000, d: 86_400_000, h: 3_600_000, min: 60_000,
  s: 1_000, ms: 1, us: 0.001, 'µs': 0.001,
}

/** Read a usable systemd timespan (e.g. "5min 30s"). Infinite or over-limit values are unknown. */
export function parseSystemdDurationMs(raw?: string): number | undefined {
  if (!raw) return undefined
  let ms = 0
  for (const token of raw.split(/\s+/)) {
    const match = /^(\d+(?:\.\d+)?)(min|ms|us|µs|w|d|h|s)$/.exec(token)
    if (!match) return undefined
    ms += Number(match[1]) * timeUnits[match[2]]
  }
  return ms > 0 && ms <= MAX_GATEWAY_WAIT_MS ? ms : undefined
}

export async function showGatewayUnit(
  unit: string, userUnit: boolean, properties: string[], env?: NodeJS.ProcessEnv,
  timeoutMs = COMMAND_GRACE_MS,
): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      ...(userUnit ? ['--user'] : []), 'show', unit,
      '--timestamp=us+utc', ...properties.flatMap(p => ['-p', p]),
    ], { encoding: 'utf8', timeout: Math.min(COMMAND_GRACE_MS, Math.max(1, Math.ceil(timeoutMs))), env })
    return parseSystemctlShow(stdout)
  } catch {
    return {}
  }
}

export function stopStartedAt(unit: Record<string, string>): number | undefined {
  if (unit.ActiveState !== 'deactivating') return undefined
  const exited = Date.parse(unit.ActiveExitTimestamp)
  const activating = Date.parse(unit.InactiveExitTimestamp)
  // StateChangeTimestamp also advances between stop substates. An ActiveExit
  // in the current invocation anchors the whole stop, including stop-sigterm.
  const start = Number.isFinite(exited) && (!Number.isFinite(activating) || exited >= activating)
    ? exited : Date.parse(unit.StateChangeTimestamp)
  return Number.isFinite(start) ? start : undefined
}

export const gatewayStopProperties = [
  'LoadState', 'ActiveState', 'TimeoutStopUSec', 'StateChangeTimestamp',
  'ActiveExitTimestamp', 'InactiveExitTimestamp',
]

type GatewayAction = 'stop' | 'start' | 'restart'

export function gatewayActionTimeout(
  action: GatewayAction, normalMs: number, unit: Record<string, string>,
): number {
  const baseline = Number.isFinite(normalMs) && normalMs > 0
    ? Math.min(MAX_GATEWAY_WAIT_MS, Math.ceil(normalMs)) : MAX_GATEWAY_WAIT_MS
  const startBudget = Math.max(baseline, systemdCommandBudget(unit.TimeoutStartUSec))
  // A start submitted during a stop also waits for systemd to finish stopping.
  const stopBudget = action === 'start' && unit.ActiveState !== 'deactivating'
    ? 0 : systemdCommandBudget(unit.TimeoutStopUSec)
  return action === 'stop'
    ? Math.max(baseline, stopBudget)
    : Math.min(MAX_GATEWAY_WAIT_MS, stopBudget + startBudget)
}

function systemdCommandBudget(raw?: string): number {
  if (!raw) return 0
  const time = parseSystemdDurationMs(raw)
  return time === undefined ? MAX_GATEWAY_WAIT_MS : Math.min(MAX_GATEWAY_WAIT_MS, Math.ceil(time) + COMMAND_GRACE_MS)
}

export async function readGatewayActionTimeout(
  action: GatewayAction, normalMs: number, unit = OPENCLAW_GATEWAY_UNIT,
  userUnit = true, env?: NodeJS.ProcessEnv,
): Promise<number> {
  const state = await showGatewayUnit(unit, userUnit, ['LoadState', 'ActiveState', 'TimeoutStopUSec', 'TimeoutStartUSec'], env)
  return gatewayActionTimeout(action, normalMs, state.LoadState === 'loaded' ? state : {})
}
