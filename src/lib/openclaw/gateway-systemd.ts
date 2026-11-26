import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const OPENCLAW_GATEWAY_UNIT = 'openclaw-gateway.service'
const COMMAND_GRACE_MS = 5_000

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

/** systemctl formats TimeoutStopUSec as a timespan (e.g. "5min 30s"). */
export function parseSystemdDurationMs(raw?: string): number | undefined {
  if (!raw) return undefined
  if (raw === 'infinity') return Infinity
  let ms = 0
  for (const token of raw.split(/\s+/)) {
    const match = /^(\d+(?:\.\d+)?)(min|ms|us|µs|w|d|h|s)$/.exec(token)
    if (!match) return undefined
    ms += Number(match[1]) * timeUnits[match[2]]
  }
  return Number.isFinite(ms) ? ms : undefined
}

export async function showGatewayUnit(
  unit: string, userUnit: boolean, properties: string[], env?: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync('systemctl', [
      ...(userUnit ? ['--user'] : []), 'show', unit,
      '--timestamp=us+utc', ...properties.flatMap(p => ['-p', p]),
    ], { encoding: 'utf8', timeout: COMMAND_GRACE_MS, env })
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
  const start = exited >= activating ? exited : Date.parse(unit.StateChangeTimestamp)
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
  const startMs = parseSystemdDurationMs(unit.TimeoutStartUSec)
  const startBudget = Math.max(normalMs, startMs !== undefined && Number.isFinite(startMs) ? startMs + COMMAND_GRACE_MS : 0)
  // A start submitted during a stop also waits for systemd to finish stopping.
  if (action === 'start' && unit.ActiveState !== 'deactivating') return startBudget
  const stopMs = parseSystemdDurationMs(unit.TimeoutStopUSec)
  if (stopMs === undefined) return action === 'stop' ? normalMs : startBudget
  // execFile's timeout of 0 leaves the unbounded stop to systemd.
  if (stopMs === Infinity) return 0
  const stopBudget = Math.ceil(stopMs) + COMMAND_GRACE_MS
  const budget = action === 'stop' ? Math.max(normalMs, stopBudget) : stopBudget + startBudget
  // Node timers above the signed 32-bit limit fire after 1 ms.
  return budget > 2_147_483_647 ? 0 : budget
}

export async function readGatewayActionTimeout(
  action: GatewayAction, normalMs: number, unit = OPENCLAW_GATEWAY_UNIT,
  userUnit = true, env?: NodeJS.ProcessEnv,
): Promise<number> {
  const state = await showGatewayUnit(unit, userUnit, ['LoadState', 'ActiveState', 'TimeoutStopUSec', 'TimeoutStartUSec'], env)
  return gatewayActionTimeout(action, normalMs, state.LoadState === 'loaded' ? state : {})
}
