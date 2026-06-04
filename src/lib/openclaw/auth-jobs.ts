import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import * as pty from 'node-pty'
import type { JobSpec } from '../jobs/runner'
import type { LogStream, TriggerSource } from '../jobs/types'
import { copyProfile, readProfiles } from './auth-profiles'
import { findProvider } from './auth-providers'

let cachedPath: string | null = null
function augmentedPath(): string {
  if (cachedPath !== null) return cachedPath
  const home = os.homedir()
  const candidates = [
    `${home}/.npm-global/bin`,
    `${home}/.linuxbrew/bin`,
    '/home/linuxbrew/.linuxbrew/bin',
    `${home}/.local/bin`,
    '/usr/local/bin',
  ]
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean)
  const merged: string[] = []
  const seen = new Set<string>()
  for (const p of [...candidates.filter((p) => existsSync(p)), ...existing]) {
    if (seen.has(p)) continue
    seen.add(p)
    merged.push(p)
  }
  cachedPath = merged.join(':')
  return cachedPath
}

function childEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: augmentedPath() }
}

// Spawn `openclaw config get models.providers.<id>` and resolve true if
// the provider is already configured. Used to decide whether to seed
// the provider template after paste-api-key / device-code.
function isProviderConfigured(providerId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'openclaw',
      ['--log-level', 'silent', '--no-color', 'config', 'get', `models.providers.${providerId}`],
      { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stdout.on('data', () => {})
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => (stderr += d))
    child.on('error', () => resolve(false))
    child.on('close', (code) => {
      // Exit 0 means the path exists (config get returns the JSON).
      // "Config path not found" → not configured yet.
      if (code === 0) resolve(true)
      else if (stderr.includes('not found')) resolve(false)
      else resolve(false)
    })
  })
}

function writeProviderConfig(providerId: string, template: unknown): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      'openclaw',
      [
        '--log-level',
        'silent',
        '--no-color',
        'config',
        'set',
        `models.providers.${providerId}`,
        JSON.stringify(template),
        '--strict-json',
      ],
      { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.on('error', () => resolve(127))
    child.on('close', (code) => resolve(code ?? 0))
  })
}

function safeSpawn(
  args: string[],
  log: (s: LogStream, t: string) => void,
  onStdoutLine: (line: string) => void,
  stdin?: string,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('openclaw', args, {
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let stdoutBuf = ''
    child.stdout.on('data', (d: string) => {
      stdoutBuf += d
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (line) {
          log('stdout', line)
          onStdoutLine(line)
        }
      }
    })
    child.stderr.on('data', (d: string) => {
      for (const line of d.split('\n')) if (line) log('stderr', line)
    })
    child.on('error', (err) => {
      log('stderr', `spawn error: ${err.message}`)
      resolve(127)
    })
    child.on('close', (code) => {
      if (stdoutBuf) {
        log('stdout', stdoutBuf)
        onStdoutLine(stdoutBuf)
      }
      resolve(code ?? 0)
    })
    if (stdin != null) {
      child.stdin.end(stdin)
    } else {
      child.stdin.end()
    }
  })
}

// Strips ANSI escape codes — openclaw prints clack output with colors.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

// PTY-based spawn for commands that require a TTY (e.g. `openclaw models auth
// login --device-code` enforces `process.stdin.isTTY` before issuing the
// device-code prompt). node-pty allocates a pseudo-terminal so the CLI sees
// a real TTY, but combines stdout/stderr.
function safePtySpawn(
  args: string[],
  log: (s: LogStream, t: string) => void,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    let proc: pty.IPty
    try {
      proc = pty.spawn('openclaw', args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: childEnv() as { [k: string]: string },
      })
    } catch (err) {
      log('stderr', `pty spawn error: ${err instanceof Error ? err.message : String(err)}`)
      resolve(127)
      return
    }

    let buf = ''
    // Clack's spinner repaints with ◒◐◓◑ frames every ~80ms via carriage-return
    // overwrites. In a PTY each tick still ends with \n, so naive logging would
    // bloat the job log with hundreds of "Waiting for device authorization…"
    // lines. We collapse consecutive lines that differ only by spinner frame.
    let lastEmittedKey = ''
    const emit = (raw: string) => {
      const line = stripAnsi(raw).trimEnd()
      if (!line) return
      // Drop leading spinner / clack-prefix glyphs before comparing.
      const key = line.replace(/^[▖-▟◒◐◓◑│└┌─├\s]+/, '')
      if (key && key === lastEmittedKey) return
      lastEmittedKey = key
      log('stdout', line)
      onLine(line)
    }

    proc.onData((data: string) => {
      buf += data
      // Split on any line terminator so spinner CR-only repaints also flush.
      const parts = buf.split(/\r\n|\r|\n/)
      buf = parts.pop() ?? ''
      for (const p of parts) emit(p)
    })

    proc.onExit(({ exitCode }) => {
      if (buf) emit(buf)
      resolve(exitCode ?? 0)
    })
  })
}

interface DeviceCodeLoginOptions {
  provider: string
  agent: string
  applyToAgents?: string[]
  triggeredBy: TriggerSource
}

export function buildDeviceCodeLoginJob(opts: DeviceCodeLoginOptions): JobSpec {
  const { provider, agent, applyToAgents = [], triggeredBy } = opts
  const profileIdHolder: { id?: string } = {}
  const beforeIds: { value: Set<string> } = { value: new Set() }

  return {
    kind: 'provider-login',
    label: `Login ${provider} (device code) → agent ${agent}`,
    triggeredBy,
    phases: [
      {
        name: `openclaw models auth login --provider ${provider} --device-code`,
        inline: async (log, ctx) => {
          const before = await readProfiles(agent)
          beforeIds.value = new Set(Object.keys(before.profiles ?? {}))
          const code = await safePtySpawn(
            ['models', 'auth', '--agent', agent, 'login', '--provider', provider, '--device-code'],
            log,
            (line) => {
              const urlMatch = line.match(/URL:\s*(https?:\/\/\S+)/)
              const codeMatch = line.match(/Code:\s*([A-Za-z0-9-]{4,})/)
              if (urlMatch) ctx.setExtra('verificationUrl', urlMatch[1])
              if (codeMatch) ctx.setExtra('userCode', codeMatch[1])
            },
          )
          return code
        },
      },
      {
        name: 'resolve new profile',
        inline: async (log) => {
          const after = await readProfiles(agent)
          const newKeys = Object.keys(after.profiles ?? {}).filter(
            (k) => k.startsWith(`${provider}:`) && !beforeIds.value.has(k),
          )
          // Pick the newly-added profile (diff-based). If none (e.g. CLI
          // refreshed an existing profile), fall back to any matching one.
          const match =
            newKeys[0] ??
            Object.keys(after.profiles ?? {}).find((k) => k.startsWith(`${provider}:`))
          if (!match) {
            log('stderr', `no ${provider}:* profile found in agent ${agent} after login`)
            return 1
          }
          profileIdHolder.id = match
          log('system', `new profile: ${match}`)
          return 0
        },
      },
      registerProviderPhase(provider),
      {
        name:
          applyToAgents.length > 0
            ? `copy profile to ${applyToAgents.length} agents`
            : 'copy profile (none requested)',
        inline: async (log) => {
          if (applyToAgents.length === 0) {
            log('system', 'no other agents selected')
            return 0
          }
          if (!profileIdHolder.id) {
            log('stderr', 'profileId unresolved — skipping copy')
            return 1
          }
          await copyProfile(profileIdHolder.id, agent, applyToAgents)
          log('system', `copied to: ${applyToAgents.join(', ')}`)
          return 0
        },
      },
    ],
  }
}

/** Phase that writes the provider's config template under
 * `models.providers.<id>` if it isn't already there. Without this step,
 * OpenClaw treats the saved auth profile as orphaned — the model never
 * shows up in `models list` because there's no provider entry pointing
 * at a baseUrl/api. Idempotent: skips when the provider is already
 * configured. */
function registerProviderPhase(providerId: string): {
  name: string
  inline: (
    log: (s: LogStream, t: string) => void,
  ) => Promise<number>
  allowFailure?: boolean
} {
  return {
    name: `register provider config (${providerId})`,
    // Failing to seed the template doesn't break auth — keep going.
    allowFailure: true,
    inline: async (log) => {
      const spec = findProvider(providerId)
      if (!spec?.providerConfig) {
        log('system', `no template for ${providerId} — skipping`)
        return 0
      }
      if (await isProviderConfigured(providerId)) {
        log('system', `${providerId} already configured — skipping`)
        return 0
      }
      const code = await writeProviderConfig(providerId, spec.providerConfig)
      if (code !== 0) {
        log('stderr', `provider config write failed (${code})`)
        return code
      }
      log('system', `registered ${providerId} with ${spec.providerConfig.models.length} model(s)`)
      return 0
    },
  }
}

interface PasteApiKeyOptions {
  provider: string
  agent: string
  apiKey: string
  applyToAgents?: string[]
  triggeredBy: TriggerSource
}

export function buildPasteApiKeyJob(opts: PasteApiKeyOptions): JobSpec {
  const { provider, agent, apiKey, applyToAgents = [], triggeredBy } = opts
  const profileIdHolder: { id?: string } = {}
  const beforeIds: { value: Set<string> } = { value: new Set() }

  return {
    kind: 'provider-login',
    label: `Paste API key for ${provider} → agent ${agent}`,
    triggeredBy,
    phases: [
      {
        name: `openclaw models auth paste-api-key --provider ${provider}`,
        inline: async (log) => {
          const before = await readProfiles(agent)
          beforeIds.value = new Set(Object.keys(before.profiles ?? {}))
          // The CLI reads the key from stdin. We pipe it in and never log it.
          return safeSpawn(
            ['models', 'auth', '--agent', agent, 'paste-api-key', '--provider', provider],
            (stream, text) => {
              // Defensive: redact if the key would somehow appear in stdout.
              const redacted = text.includes(apiKey)
                ? text.replace(apiKey, '<redacted>')
                : text
              log(stream, redacted)
            },
            () => {},
            apiKey + '\n',
          )
        },
      },
      {
        name: 'resolve new profile',
        inline: async (log) => {
          const after = await readProfiles(agent)
          const newKeys = Object.keys(after.profiles ?? {}).filter(
            (k) => k.startsWith(`${provider}:`) && !beforeIds.value.has(k),
          )
          const match =
            newKeys[0] ??
            Object.keys(after.profiles ?? {}).find((k) => k.startsWith(`${provider}:`))
          if (!match) {
            log('stderr', `no ${provider}:* profile found in agent ${agent} after paste`)
            return 1
          }
          profileIdHolder.id = match
          log('system', `new profile: ${match}`)
          return 0
        },
      },
      registerProviderPhase(provider),
      {
        name:
          applyToAgents.length > 0
            ? `copy profile to ${applyToAgents.length} agents`
            : 'copy profile (none requested)',
        inline: async (log) => {
          if (applyToAgents.length === 0) {
            log('system', 'no other agents selected')
            return 0
          }
          if (!profileIdHolder.id) {
            log('stderr', 'profileId unresolved — skipping copy')
            return 1
          }
          await copyProfile(profileIdHolder.id, agent, applyToAgents)
          log('system', `copied to: ${applyToAgents.join(', ')}`)
          return 0
        },
      },
    ],
  }
}
