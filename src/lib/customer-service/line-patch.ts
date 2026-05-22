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

function findLineDistDirs(): string[] {
  // 5.5+ ships LINE as the external `@openclaw/line` package; legacy 4.x
  // bundled the LINE handler inside `openclaw/dist`. Look at both.
  const dirs: string[] = []
  const roots: string[] = [
    join(homedir(), '.openclaw', 'npm', 'node_modules'),
  ]

  const nvmVersions = join(homedir(), '.nvm', 'versions', 'node')
  if (existsSync(nvmVersions)) {
    try {
      for (const v of readdirSync(nvmVersions)) {
        roots.push(join(nvmVersions, v, 'lib', 'node_modules'))
      }
    } catch {
      /* ignore */
    }
  }
  roots.push(
    join(homedir(), '.npm-global', 'lib', 'node_modules'),
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
  )

  const seen = new Set<string>()
  for (const root of roots) {
    for (const sub of ['@openclaw/line/dist', 'openclaw/dist']) {
      const dir = join(root, sub)
      if (!seen.has(dir) && existsSync(dir)) {
        dirs.push(dir)
        seen.add(dir)
      }
    }
  }
  return dirs
}

function findLineDistFiles(): string[] {
  const out: string[] = []
  for (const dir of findLineDistDirs()) {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries) {
      const isMonitor = f.startsWith('monitor-') && f.endsWith('.js')
      const isRuntimeApi = f === 'runtime-api.js'
      if (!isMonitor && !isRuntimeApi) continue
      const path = join(dir, f)
      try {
        const content = readFileSync(path, 'utf-8')
        if (content.includes('line: received')) out.push(path)
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out
}

export interface LinePatchStatus {
  scriptInstalled: boolean
  scriptPath: string
  distPatched: boolean
  distPath: string | null
  distPaths: string[]
  dropinInstalled: boolean
  dropinPath: string
}

export function getStatus(): LinePatchStatus {
  const scriptInstalled = existsSync(PATCH_SCRIPT)
  const distPaths = findLineDistFiles()
  let distPatched = false
  if (distPaths.length > 0) {
    distPatched = distPaths.every((p) => {
      try {
        const content = readFileSync(p, 'utf-8')
        // Legacy marker — only present when our script applied the patch.
        const hasScriptMarker = /line (onEvents|bot\.handleWebhook|plugin-bound) bg error:/.test(
          content,
        )
        // openclaw 2026.5.5+ ships the async-ack flow natively. The script
        // correctly skips these files, but the file ends up without our
        // marker — so we also accept the upstream fire-and-forget pattern.
        const hasNativeAsync = /Promise\.resolve\(\)\s*\.then\(\s*\(\s*\)\s*=>\s*(onEvents|[\w.]+\.handleWebhook)\s*\(/.test(
          content,
        )
        const hasUnpatched = /await\s+(onEvents|params\.bot\.handleWebhook|match\.target\.bot\.handleWebhook)\s*\(/.test(
          content,
        )
        return (hasScriptMarker || hasNativeAsync) && !hasUnpatched
      } catch {
        return false
      }
    })
  }
  return {
    scriptInstalled,
    scriptPath: PATCH_SCRIPT,
    distPatched,
    distPath: distPaths[0] ?? null,
    distPaths,
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
