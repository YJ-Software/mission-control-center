import { execFile } from 'child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { GATEWAY_HTTP, GATEWAY_URL } from '../openclaw'
import { compareVersions } from '../version-compare'
import { logTempRootFailureHint, tightenOpenclawTempRoots } from './temp-root-perms'
import {
  gatewayActionTimeout, gatewayUserUnits, OPENCLAW_GATEWAY_UNIT, showGatewayUnit,
} from './gateway-systemd'
import { waitForGatewayStart } from './update-memory-guard'
import { telegramBarrierProperties, waitForTelegramStartup } from './telegram-restart-barrier'

const execFileAsync = promisify(execFile)
const actionProperties = ['LoadState', 'ActiveState', 'TimeoutStopUSec', 'TimeoutStartUSec']

/** Check launcher and port drift before restarting the loaded definition in place. */
function nativeReadinessUrl(unit: Record<string, string>, env: NodeJS.ProcessEnv): URL | undefined {
  const uid = process.getuid?.()
  if (!['active', 'activating', 'reloading', 'deactivating'].includes(unit.ActiveState) ||
    unit.NeedDaemonReload === 'yes' || uid === undefined ||
    !unit.ControlGroup?.startsWith(`/user.slice/user-${uid}.slice/user@${uid}.service/`)) return
  // Only recognize the ordinary Node package launcher. Recovery of custom
  // launchers, missing binaries and temporary upgrade paths belongs to OpenClaw.
  // The OCD-managed launcher can include a Node heap limit.
  const launcher = /^\{ path=(\S+) ; argv\[\]=\1(?: --max-old-space-size=[1-9]\d*)? (\S+\/dist\/index\.js) gateway --port (\d+) ;/.exec(unit.ExecStart ?? '')
  if (!launcher || path.basename(launcher[1]) !== 'node') return
  if (env.OPENCLAW_HOME || env.OPENCLAW_SUPERVISOR_MODE?.trim().toLowerCase() === 'external' ||
    env.OPENCLAW_UPDATE_IN_PROGRESS || env.OPENCLAW_SERVICE_KIND === 'node') return

  try {
    const [, node, entrypoint, port] = launcher
    const profile = env.OPENCLAW_PROFILE?.trim()
    const stateDir = path.join(env.HOME || homedir(),
      profile && profile.toLowerCase() !== 'default' ? `.openclaw-${profile}` : '.openclaw')
    const configFile = path.join(stateDir, 'openclaw.json')
    if ((env.OPENCLAW_STATE_DIR && env.OPENCLAW_STATE_DIR !== stateDir) ||
      (env.OPENCLAW_CONFIG_PATH && env.OPENCLAW_CONFIG_PATH !== configFile)) return
    const raw = readFileSync(configFile, 'utf8')
    // Let OpenClaw resolve config files that may change the target via includes.
    if (raw.includes('"$include"')) return
    const { gateway, meta } = JSON.parse(raw)
    if (gateway?.mode === 'remote' || (gateway?.port !== undefined && String(gateway.port) !== port) ||
      (env.OPENCLAW_GATEWAY_PORT && env.OPENCLAW_GATEWAY_PORT !== port)) return

    const temporaryRoots = new Set([tmpdir(), '/tmp', '/var/tmp', '/private/tmp'])
    const paths = [node, entrypoint, realpathSync(node), realpathSync(entrypoint)]
    if (paths.some(p => [...temporaryRoots].some(root => p === root || p.startsWith(root + path.sep)))) return
    const installed = JSON.parse(readFileSync(path.join(path.dirname(entrypoint), '..', 'package.json'), 'utf8'))
    if (installed.name !== 'openclaw' || typeof installed.version !== 'string' ||
      (meta?.lastTouchedVersion && compareVersions(meta.lastTouchedVersion, installed.version) > 0)) return

    const url = new URL('/readyz', env.OPENCLAW_GATEWAY_HTTP || GATEWAY_HTTP)
    const ws = new URL(env.OPENCLAW_GATEWAY_WS || GATEWAY_URL)
    for (const address of [url, ws]) {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== port) return
    }
    // The CLI can verify OpenClaw's own certificates on TLS listeners.
    if (url.protocol !== 'http:' || ws.protocol !== 'ws:' || gateway?.tls?.enabled) return
    return url
  } catch {
    return
  }
}

export async function restartOpenclawGateway(options: {
  timeout: number
  env?: NodeJS.ProcessEnv
  /** Credential changes need OpenClaw's own SecretRef and service-env diagnostics. */
  useCli?: boolean
  /** Wall-clock time immediately before writing a config that may hot-reload. */
  configWrittenAt?: number
}) {
  const { timeout: normalMs, env = process.env, useCli, configWrittenAt } = options
  const log = (text: string) => console.log(`[OpenClawRestart] ${text}`)
  tightenOpenclawTempRoots(log, env)
  const units = gatewayUserUnits(env)
  let unit = units[0] ?? OPENCLAW_GATEWAY_UNIT
  let state: Record<string, string> = {}
  if (process.platform === 'linux') {
    for (const candidate of units) {
      const current = await showGatewayUnit(candidate, true, [
        ...actionProperties, 'ControlGroup', 'ExecStart', 'NeedDaemonReload', ...telegramBarrierProperties,
      ], env)
      if (current.LoadState !== 'loaded') continue
      unit = candidate
      state = current
      break
    }
  }
  let readiness = useCli ? undefined : nativeReadinessUrl(state, env)
  if (readiness) {
    const systemUnits = await Promise.all(units.map(name => showGatewayUnit(name, false, ['LoadState'], env)))
    if (systemUnits.some(s => s.LoadState === 'loaded')) readiness = undefined
  }
  const timeout = gatewayActionTimeout('restart', normalMs, state)
  await waitForTelegramStartup(unit, state, env, configWrittenAt)
  const since = Date.now()
  let result
  try {
    if (!readiness) return await execFileAsync('openclaw', ['gateway', 'restart'], { env, timeout, encoding: 'utf8' })
    // Match the CLI's order so a unit that hit its start limit can restart.
    await execFileAsync('systemctl', ['--user', 'reset-failed', unit], { env, timeout: 5_000, encoding: 'utf8' })
    result = await execFileAsync('systemctl', ['--user', 'restart', unit], { env, timeout, encoding: 'utf8' })
  } catch (err) {
    await logTempRootFailureHint(unit, true, since, log, env)
    throw err
  }

  const url = readiness
  let failure = ''
  const code = await waitForGatewayStart(unit, true, since, (stream, text) => {
    log(text)
    if (stream === 'stderr' && !failure) failure = text
  }, {
    env, stableMs: 0, restartCount: 0,
    timeoutMs: gatewayActionTimeout('start', normalMs, { TimeoutStartUSec: state.TimeoutStartUSec }),
    isReady: async timeoutMs => {
      try {
        const response = await fetch(url, {
          method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(Math.ceil(Math.min(3_000, timeoutMs))),
        })
        return response.status === 200
      } catch {
        return false
      }
    },
  })
  if (code !== 0) throw new Error(failure)
  return { ...result, stdout: result.stdout || `Restarted systemd service: ${unit}\n` }
}
