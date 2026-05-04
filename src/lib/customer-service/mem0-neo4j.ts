import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const DATA_DIR = join(homedir(), '.openclaw', 'mem0-neo4j')
const DEFAULT_PASSWORD = 'openclaw-mem0'
const CONTAINER_NAME = 'openclaw-mem0-neo4j'

export interface Neo4jStatus {
  containerExists: boolean
  containerRunning: boolean
  reachable: boolean
  enabledInMcp: boolean
  url: string
  username: string
  hasPassword: boolean
}

async function dockerOk(args: string[], timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: timeoutMs, env: getServerEnv() })
    return { ok: true, stdout, stderr }
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.message?.includes('permission denied')) {
      try {
        const { stdout, stderr } = await execFileAsync('sg', ['docker', '-c', `docker ${args.join(' ')}`], { timeout: timeoutMs, env: getServerEnv() })
        return { ok: true, stdout, stderr }
      } catch (err2: any) {
        return { ok: false, stdout: err2?.stdout ?? '', stderr: err2?.stderr ?? err2?.message ?? '' }
      }
    }
    return { ok: false, stdout: err?.stdout ?? '', stderr: err?.stderr ?? err?.message ?? '' }
  }
}

function readMcpEntry(): Record<string, any> | null {
  if (!existsSync(OPENCLAW_CONFIG)) return null
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    return cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0'] ?? null
  } catch {
    return null
  }
}

export async function getStatus(): Promise<Neo4jStatus> {
  const inspect = await dockerOk(['inspect', '--format', '{{.State.Running}}', CONTAINER_NAME])
  const containerExists = inspect.ok || (!inspect.ok && /No such object/.test(inspect.stderr) === false)
  const containerRunning = inspect.ok && inspect.stdout.trim() === 'true'

  let reachable = false
  if (containerRunning) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 3000)
      const res = await fetch('http://127.0.0.1:7474/', { signal: ctrl.signal })
      clearTimeout(t)
      reachable = res.ok || res.status === 401
    } catch {
      reachable = false
    }
  }

  const entry = readMcpEntry()
  const env = (entry?.env ?? {}) as Record<string, string>
  return {
    containerExists,
    containerRunning,
    reachable,
    enabledInMcp: Boolean(env.MEM0_NEO4J_URL),
    url: env.MEM0_NEO4J_URL ?? `bolt://127.0.0.1:7687`,
    username: env.MEM0_NEO4J_USER ?? 'neo4j',
    hasPassword: Boolean(env.MEM0_NEO4J_PASSWORD),
  }
}

export async function installAndStart(password = DEFAULT_PASSWORD): Promise<{ output: string }> {
  const mk = await execFileAsync('mkdir', ['-p', DATA_DIR], { env: getServerEnv() })
  let output = (mk.stdout || '') + (mk.stderr || '')

  const inspect = await dockerOk(['inspect', '--format', '{{.State.Running}}', CONTAINER_NAME])
  if (inspect.ok) {
    if (inspect.stdout.trim() === 'true') {
      output += '\nneo4j container already running'
    } else {
      const start = await dockerOk(['start', CONTAINER_NAME])
      output += '\n' + (start.stdout || start.stderr || '')
    }
    return { output }
  }

  const run = await dockerOk([
    'run',
    '-d',
    '--name',
    CONTAINER_NAME,
    '--restart=unless-stopped',
    '-p',
    '127.0.0.1:7474:7474',
    '-p',
    '127.0.0.1:7687:7687',
    '-v',
    `${DATA_DIR}:/data`,
    '-e',
    `NEO4J_AUTH=neo4j/${password}`,
    '-e',
    'NEO4J_PLUGINS=["apoc"]',
    'neo4j:5-community',
  ], 600_000)
  output += '\n' + (run.stdout || run.stderr || '')
  if (!run.ok) {
    throw new Error(run.stderr || 'neo4j docker run failed')
  }
  return { output }
}

export async function stop(): Promise<{ output: string }> {
  const stop = await dockerOk(['stop', CONTAINER_NAME])
  return { output: (stop.stdout || stop.stderr || '') }
}

export async function remove(): Promise<{ output: string }> {
  await dockerOk(['stop', CONTAINER_NAME])
  const rm = await dockerOk(['rm', CONTAINER_NAME])
  return { output: rm.stdout || rm.stderr || '' }
}

export async function bindToMcp(password = DEFAULT_PASSWORD): Promise<string> {
  if (!existsSync(OPENCLAW_CONFIG)) throw new Error('openclaw.json missing')
  const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
  const entry = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
  if (!entry) throw new Error('mem0 mcp not registered')

  const env = {
    ...(entry.env ?? {}),
    MEM0_NEO4J_URL: 'bolt://127.0.0.1:7687',
    MEM0_NEO4J_USER: 'neo4j',
    MEM0_NEO4J_PASSWORD: password,
  }
  const value = { ...entry, env }
  const out = await execFileAsync(
    'openclaw',
    ['mcp', 'set', 'openclaw-mem0', JSON.stringify(value)],
    { timeout: 30000, env: getServerEnv() },
  )
  return (out.stdout || '') + (out.stderr || '')
}

export async function unbindFromMcp(): Promise<string> {
  if (!existsSync(OPENCLAW_CONFIG)) throw new Error('openclaw.json missing')
  const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
  const entry = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
  if (!entry) return 'mem0 mcp not registered'
  const env = { ...(entry.env ?? {}) }
  delete env.MEM0_NEO4J_URL
  delete env.MEM0_NEO4J_USER
  delete env.MEM0_NEO4J_PASSWORD
  const value = { ...entry, env }
  const out = await execFileAsync(
    'openclaw',
    ['mcp', 'set', 'openclaw-mem0', JSON.stringify(value)],
    { timeout: 30000, env: getServerEnv() },
  )
  return (out.stdout || '') + (out.stderr || '')
}

export async function restartGateway(): Promise<string> {
  try {
    const out = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
    return (out.stdout || '') + (out.stderr || '')
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}
