import { execFile } from 'node:child_process'
import { constants, accessSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { load as loadYaml } from 'js-yaml'
import { capabilitiesFor } from './capabilities'
import { ensureHermesDotenvKey, hermesBaseUrl, hermesHome, readOptionalFile, resolveHermesConfig } from './hermes-config'

const unit = capabilitiesFor('hermes').service.userUnit

function command(file: string, args: string[], timeout: number, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, HERMES_HOME: hermesHome() }, timeout }, (err, stdout) => {
      if (err) reject(new Error(`${label} failed (${err.code ?? err.signal ?? 'unknown error'})`))
      else resolve(String(stdout))
    })
  })
}

export async function hermesService(action: 'start' | 'stop' | 'restart'): Promise<void> {
  await command('systemctl', ['--user', action, unit], 120_000, `Hermes gateway ${action}`)
}

export async function hermesServiceActive(): Promise<boolean | null> {
  try {
    const output = await command('systemctl', ['--user', 'show', '-p', 'LoadState', '-p', 'ActiveState', unit], 3_000, 'Hermes gateway status')
    return output.split('\n').includes('LoadState=loaded') ? output.split('\n').includes('ActiveState=active') : null
  } catch {
    return null
  }
}

function findHermesBinary(): string | undefined {
  const candidates = [
    process.env.HERMES_BIN,
    process.env.HERMES_INSTALL_DIR && join(process.env.HERMES_INSTALL_DIR, '.venv', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    '/opt/hermes/.venv/bin/hermes',
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'hermes')),
  ]
  return candidates.find((file): file is string => {
    if (!file) return false
    try {
      accessSync(file, constants.X_OK)
      return statSync(file).isFile()
    } catch {
      return false
    }
  })
}

export async function runHermesCli(args: string[], timeout: number): Promise<void> {
  const binary = findHermesBinary()
  if (!binary) throw new Error('Hermes CLI not found. Set HERMES_BIN to its executable path.')
  await command(binary, args, timeout, `Hermes ${args[0]}`)
}

function installedHermesVersion(): string | null {
  const binary = findHermesBinary()
  const roots = [process.env.HERMES_INSTALL_DIR]
  try {
    if (binary) roots.push(join(dirname(realpathSync(binary)), '..', '..'))
  } catch { /* CLI could have been replaced during detection */ }
  for (const root of roots) {
    if (!root) continue
    try {
      const metadata = readOptionalFile(join(root, 'hermes_cli', '__init__.py'))
      const version = metadata?.match(/^__version__\s*=\s*["']([^"']+)["']/m)?.[1]
      if (version) return version
    } catch { /* report version as unknown when metadata cannot be read */ }
  }
  return null
}

function healthRequest(path: string, timeoutMs: number, apiKey?: string) {
  return fetch(`${hermesBaseUrl()}${path}`, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
  })
}

export async function getHermesVersion(): Promise<string | null> {
  try {
    const res = await healthRequest('/health', 2_000)
    if (res.ok) {
      const body = await res.json() as { version?: unknown }
      if (typeof body.version === 'string' && body.version) return body.version
    }
  } catch { /* try installed metadata when the gateway is down */ }
  return installedHermesVersion()
}

export async function waitForHermesHealth({ detailed = false, timeoutMs = 30_000 } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const apiKey = detailed ? resolveHermesConfig().apiKey : undefined
  while (Date.now() < deadline) {
    try {
      const timeout = () => Math.max(1, Math.min(2_000, deadline - Date.now()))
      const basic = await healthRequest('/health', timeout())
      await basic.body?.cancel()
      if (basic.status === 200) {
        if (!detailed) return
        const authenticated = await healthRequest('/health/detailed', timeout(), apiKey)
        await authenticated.body?.cancel()
        if (authenticated.status === 200) return
      }
    } catch { /* retry during service startup */ }
    const remaining = deadline - Date.now()
    if (remaining > 0) await delay(Math.min(500, remaining))
  }
  throw new Error(`Hermes ${detailed ? '/health and /health/detailed' : '/health'} did not become ready within ${timeoutMs / 1000}s`)
}

interface ApiPlatform { enabled?: boolean | string }
interface HermesYaml {
  gateway?: { platforms?: { api_server?: ApiPlatform }; api_server?: ApiPlatform }
  platforms?: { api_server?: ApiPlatform }
}

export async function provisionHermesApi(warn: (message: string) => void = console.warn): Promise<void> {
  let config: HermesYaml | undefined
  try {
    config = loadYaml(readOptionalFile(join(hermesHome(), 'config.yaml')) ?? '') as HermesYaml | undefined
  } catch {
    warn('[Hermes] Cannot read config.yaml to check whether api_server is disabled. Check the Hermes configuration.')
    return
  }
  const enabled = config?.gateway?.api_server?.enabled
    ?? config?.platforms?.api_server?.enabled
    ?? config?.gateway?.platforms?.api_server?.enabled
  const keyChanged = ensureHermesDotenvKey()
  const { apiKey } = resolveHermesConfig()
  const envKey = process.env.HERMES_API_KEY?.trim()
  if (envKey && envKey !== apiKey) {
    warn('[Hermes] HERMES_API_KEY differs from API_SERVER_KEY in the Hermes .env. Using the Hermes .env key.')
  }
  if (enabled === false || (typeof enabled === 'string' && /^(off|no)$/i.test(enabled))) {
    warn('[Hermes] api_server is explicitly disabled in config.yaml. Enable it to use the dashboard.')
    return
  }
  if (!keyChanged) {
    try {
      const response = await healthRequest('/health/detailed', 2_000, apiKey)
      await response.body?.cancel()
      if (response.status === 200) return
    } catch { /* an earlier boot may have written the key without bringing the API up */ }
  }

  await hermesService('restart')
  await waitForHermesHealth({ detailed: true })
}
