import { spawn } from 'node:child_process'
import { augmentedPath } from './models-config'

/** Enabling a plugin in openclaw.json that OpenClaw has not been given
 * capability consent for makes 2026.8.1 refuse to report the gateway ready:
 *
 *   Plugin "X" requires capability consent.
 *   OpenClaw plugin verification failed; refusing to report the gateway ready.
 *
 * systemd then restart-loops until it gives up. Two separate MCC features hit
 * this — provider auth (kimi) and the wiki purpose switch (memory-lancedb) —
 * so the guard lives here rather than in either caller.
 *
 * Note that "the npm package is on disk" is NOT the same as "consented":
 * OpenClaw's own startup repair will npm-install a configured-but-missing
 * plugin and then still refuse to start, because consent was never granted.
 * `plugins list` is the check that actually tracks consent. */

// Run an openclaw subcommand and capture stdout. The probe has to read
// `plugins list` / `plugins search` output rather than just an exit code.
function captureOpenclaw(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('openclaw', ['--no-color', ...args], {
      env: { ...process.env, PATH: augmentedPath() },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', () => {})
    child.on('error', () => resolve({ code: 127, stdout: '' }))
    child.on('close', (code: number | null) => resolve({ code: code ?? 0, stdout }))
  })
}

/** Indirection so the consent guard can be unit-tested without a live
 * OpenClaw. `listed` = plugin is installed, registered AND consented;
 * `available` = this OpenClaw build knows the plugin exists at all (false on
 * older versions that predate it). */
export interface PluginProbe {
  listed: (pluginId: string) => Promise<boolean>
  available: (pluginId: string) => Promise<boolean>
  install: (pluginPackage: string) => Promise<number>
}

export const realPluginProbe: PluginProbe = {
  listed: async (pluginId) => {
    const { code, stdout } = await captureOpenclaw(['plugins', 'list'])
    if (code !== 0) return false
    // `plugins list` renders a table; the id sits in its own column.
    return new RegExp(`\\b${pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(stdout)
  },
  available: async (pluginId) => {
    const { code, stdout } = await captureOpenclaw(['plugins', 'search', pluginId])
    if (code !== 0) return false
    return /clawhub:|Install:/i.test(stdout)
  },
  install: async (pluginPackage) => {
    const { code } = await captureOpenclaw([
      'plugins',
      'install',
      pluginPackage,
      '--accept-capabilities',
    ])
    return code
  },
}

export type ConsentLog = (stream: 'system' | 'stderr', text: string) => void

/** Make sure `pluginId` is installed and capability-consented BEFORE anything
 * writes config that enables it.
 *
 * Returns 0 to continue. Returns non-zero only in the one case where
 * continuing would brick the gateway: this OpenClaw knows the plugin, it is
 * not consented, and we failed to install it. */
export async function ensurePluginConsented(
  pluginId: string,
  pluginPackage: string,
  probe: PluginProbe,
  log: ConsentLog,
): Promise<number> {
  if (await probe.listed(pluginId)) {
    log('system', `plugin ${pluginId} already installed`)
    return 0
  }
  if (!(await probe.available(pluginId))) {
    // Older OpenClaw with no such plugin — the caller's pre-plugin path
    // (provider config template / stock memory plugin) still applies.
    log('system', `no ${pluginId} plugin on this OpenClaw`)
    return 0
  }

  log('system', `installing ${pluginPackage} with capability consent`)
  const code = await probe.install(pluginPackage)
  if (code !== 0) {
    log(
      'stderr',
      `failed to install ${pluginPackage} (exit ${code}). Refusing to enable ` +
        `"${pluginId}": OpenClaw would demand capability consent for it at ` +
        `gateway startup and refuse to start, with no way to grant it.`,
    )
    return code
  }
  log('system', `installed ${pluginId}`)
  return 0
}
