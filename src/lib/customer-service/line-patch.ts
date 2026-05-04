/**
 * Manage the OpenClaw LINE webhook async-ack patch + the systemd drop-in
 * that re-applies it on every gateway start.
 *
 * Why: OpenClaw's bundled dist file `await`s the full agent turn before
 * returning HTTP 200 to LINE. LINE's webhook timeout is 1 second; agent
 * turns take 30-120 seconds. Without the patch every customer message
 * times out and gets retried 2-3x → duplicate replies.
 *
 * The patch script ships with the openclaw-line-cs-agent skill at
 * `~/.claude/skills/openclaw-line-cs-agent/references/scripts/apply-line-async-ack-patch.sh`.
 * It's idempotent and handles all three webhook handlers (Express,
 * raw http, and plugin-bound which was added in OpenClaw 2026.4.29).
 *
 * The drop-in re-runs the patch script before every gateway start so
 * `npm update -g openclaw` (which overwrites the dist files but not the
 * systemd .d/ directory) doesn't silently break the deployment.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const PATCH_SCRIPT = join(
  homedir(),
  '.claude',
  'skills',
  'openclaw-line-cs-agent',
  'references',
  'scripts',
  'apply-line-async-ack-patch.sh',
)

const SYSTEMD_DIR = join(homedir(), '.config', 'systemd', 'user', 'openclaw-gateway.service.d')
const DROPIN_PATH = join(SYSTEMD_DIR, 'repatch.conf')

function buildDropinContent(nodeBinDir: string, scriptPath: string): string {
  return [
    '# Re-applies the LINE async-ack patch every time the gateway starts.',
    '# Survives `npm update -g openclaw` because OpenClaw\'s installer only',
    '# overwrites the main openclaw-gateway.service file, not files in this',
    '# .d/ drop-in directory.',
    '#',
    '# The patch script is idempotent — if the dist file is already patched',
    '# (or doesn\'t need patching, for a future OpenClaw version that ships',
    '# the async-ack pattern upstream), it exits 0 silently.',
    '#',
    '# Leading `-` on ExecStartPre means a non-zero exit doesn\'t block the',
    '# gateway from starting, just in case the patch script ever fails.',
    '',
    '[Service]',
    `ExecStartPre=-/usr/bin/bash -c 'PATH=${nodeBinDir}:$PATH bash ${scriptPath} > /tmp/openclaw-line-patch.log 2>&1'`,
    '',
  ].join('\n')
}

function findOpenclawDistDir(): string | null {
  // Common install layouts. Take the first that has openclaw/dist with the
  // expected webhook-bearing monitor file inside.
  const candidates: string[] = []

  // nvm: walk versions/<v*> looking for lib/node_modules/openclaw/dist
  const nvmVersions = join(homedir(), '.nvm', 'versions', 'node')
  if (existsSync(nvmVersions)) {
    try {
      for (const v of readdirSync(nvmVersions)) {
        candidates.push(join(nvmVersions, v, 'lib', 'node_modules', 'openclaw', 'dist'))
      }
    } catch {
      /* ignore */
    }
  }
  candidates.push(
    join(homedir(), '.npm-global', 'lib', 'node_modules', 'openclaw', 'dist'),
    '/usr/lib/node_modules/openclaw/dist',
    '/usr/local/lib/node_modules/openclaw/dist',
  )

  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    return dir
  }
  return null
}

function findOpenclawDistFile(): string | null {
  const dir = findOpenclawDistDir()
  if (!dir) return null
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const f of entries) {
    if (!f.startsWith('monitor-') || !f.endsWith('.js')) continue
    const path = join(dir, f)
    try {
      const content = readFileSync(path, 'utf-8')
      if (content.includes('line: received')) return path
    } catch {
      /* skip unreadable */
    }
  }
  return null
}

export interface LinePatchStatus {
  scriptInstalled: boolean
  scriptPath: string
  distPatched: boolean
  distPath: string | null
  dropinInstalled: boolean
  dropinPath: string
}

export function getStatus(): LinePatchStatus {
  const scriptInstalled = existsSync(PATCH_SCRIPT)
  const distPath = findOpenclawDistFile()
  let distPatched = false
  if (distPath) {
    try {
      const content = readFileSync(distPath, 'utf-8')
      const hasMarker =
        content.includes('line onEvents bg error:') &&
        content.includes('line bot.handleWebhook bg error:')
      const hasUnpatched = /await\s+(onEvents|params\.bot\.handleWebhook|match\.target\.bot\.handleWebhook)\s*\(/.test(
        content,
      )
      distPatched = hasMarker && !hasUnpatched
    } catch {
      distPatched = false
    }
  }
  return {
    scriptInstalled,
    scriptPath: PATCH_SCRIPT,
    distPatched,
    distPath,
    dropinInstalled: existsSync(DROPIN_PATH),
    dropinPath: DROPIN_PATH,
  }
}

export async function applyPatch(): Promise<{ output: string }> {
  if (!existsSync(PATCH_SCRIPT)) {
    throw new Error(
      `Patch script missing at ${PATCH_SCRIPT}. Install the openclaw-line-cs-agent skill first.`,
    )
  }
  const env = getServerEnv()
  // Make sure node + openclaw bins are in PATH for the patch script.
  const nodeBinDir = `${homedir()}/.nvm/versions/node/v24.15.0/bin`
  const result = await execFileAsync('bash', [PATCH_SCRIPT], {
    env: { ...env, PATH: `${nodeBinDir}:${env.PATH ?? ''}` },
    timeout: 30000,
    encoding: 'utf-8',
  })
  return { output: (result.stdout || '') + (result.stderr || '') }
}

export function installDropin(): { output: string } {
  if (!existsSync(SYSTEMD_DIR)) mkdirSync(SYSTEMD_DIR, { recursive: true })
  const nodeBinDir = `${homedir()}/.nvm/versions/node/v24.15.0/bin`
  writeFileSync(DROPIN_PATH, buildDropinContent(nodeBinDir, PATCH_SCRIPT), 'utf-8')
  return { output: `wrote ${DROPIN_PATH}` }
}

export async function reloadAndRestart(): Promise<string> {
  const env = getServerEnv()
  let out = ''
  try {
    const r1 = await execFileAsync('systemctl', ['--user', 'daemon-reload'], { env, timeout: 15000 })
    out += (r1.stdout || '') + (r1.stderr || '')
  } catch (err: any) {
    out += err?.stderr ?? err?.message ?? ''
  }
  try {
    const r2 = await execFileAsync('systemctl', ['--user', 'restart', 'openclaw-gateway'], {
      env,
      timeout: 60000,
    })
    out += '\n' + (r2.stdout || '') + (r2.stderr || '')
  } catch (err: any) {
    out += '\n' + (err?.stderr ?? err?.message ?? '')
  }
  return out
}
