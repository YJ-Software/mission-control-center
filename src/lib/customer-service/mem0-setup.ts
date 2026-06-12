/**
 * mem0 self-hosted stack: detection + install orchestration.
 *
 * Components:
 *   - Docker (system pkg, for Qdrant container)
 *   - Ollama (curl install script + bge-m3 model for embeddings)
 *   - Qdrant (Docker container, persistent volume)
 *   - uv (Python package manager, for the MCP server)
 *   - MCP server (deploy/mcp/openclaw-mem0/, registered in openclaw.json mcpServers)
 *
 * The wizard streams progress events via SSE so the UI can render a live
 * checklist. Each step is idempotent — already-installed components are
 * detected and skipped.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { readAuthStoreDb, findProviderKey, type ProfilesFile } from '@/lib/openclaw/auth-profiles'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const MCP_SOURCE_DIR = resolve(
  process.cwd(),
  'deploy',
  'mcp',
  'openclaw-mem0',
)

export interface ComponentStatus {
  id: 'docker' | 'ollama' | 'bge-m3' | 'qdrant' | 'uv' | 'mcp'
  label: string
  ready: boolean
  detail?: string
  error?: string
}

export type StepName = ComponentStatus['id']

export interface ProgressEvent {
  stage: 'check' | 'install' | 'log' | 'error' | 'done'
  step?: StepName
  message: string
  ready?: boolean
}

export type ProgressCallback = (event: ProgressEvent) => void

async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin], {
      encoding: 'utf-8',
      env: getServerEnv(),
    })
    const out = stdout.trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

async function commandSucceeds(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 10000, env: getServerEnv() })
    return true
  } catch {
    return false
  }
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export async function detectAll(): Promise<ComponentStatus[]> {
  const docker = await detectDocker()
  const ollama = await detectOllama()
  const bgem3 = await detectBgeM3()
  const qdrant = await detectQdrant()
  const uv = await detectUv()
  const mcp = await detectMcp()
  return [docker, ollama, bgem3, qdrant, uv, mcp]
}

async function detectDocker(): Promise<ComponentStatus> {
  const bin = await which('docker')
  if (!bin) return { id: 'docker', label: 'Docker', ready: false, detail: 'not installed' }
  // Try direct docker ps first; if it fails (group not propagated yet), retry via sg docker.
  const okDirect = await commandSucceeds('docker', ['ps'])
  if (okDirect) {
    return { id: 'docker', label: 'Docker', ready: true, detail: 'running' }
  }
  const okGroup = await commandSucceeds('sg', ['docker', '-c', 'docker ps'])
  return {
    id: 'docker',
    label: 'Docker',
    ready: okGroup,
    detail: okGroup
      ? 'running (via sg docker — restart this dashboard process to pick up group)'
      : 'binary present, daemon unreachable (docker.sock permission?)',
  }
}

async function detectOllama(): Promise<ComponentStatus> {
  const bin = await which('ollama')
  if (!bin) return { id: 'ollama', label: 'Ollama', ready: false, detail: 'not installed' }
  const ok = await fetchOk('http://127.0.0.1:11434/api/tags')
  return {
    id: 'ollama',
    label: 'Ollama',
    ready: ok,
    detail: ok ? 'service active on :11434' : 'binary present, service offline',
  }
}

async function detectBgeM3(): Promise<ComponentStatus> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags')
    if (!res.ok) return { id: 'bge-m3', label: 'bge-m3 (embedding)', ready: false, detail: 'ollama unreachable' }
    const json = (await res.json()) as { models?: Array<{ name?: string }> }
    const has = (json.models ?? []).some((m) => (m.name ?? '').startsWith('bge-m3'))
    return {
      id: 'bge-m3',
      label: 'bge-m3 (embedding)',
      ready: has,
      detail: has ? '1024d model present' : 'model not pulled',
    }
  } catch {
    return { id: 'bge-m3', label: 'bge-m3 (embedding)', ready: false, detail: 'ollama unreachable' }
  }
}

async function detectQdrant(): Promise<ComponentStatus> {
  const ok = await fetchOk('http://127.0.0.1:6333/healthz')
  return {
    id: 'qdrant',
    label: 'Qdrant (vector store)',
    ready: ok,
    detail: ok ? 'healthy on :6333' : 'not running',
  }
}

async function detectUv(): Promise<ComponentStatus> {
  const bin = (await which('uv')) ?? (existsSync(`${homedir()}/.local/bin/uv`) ? `${homedir()}/.local/bin/uv` : null)
  if (!bin) return { id: 'uv', label: 'uv (Python pkg manager)', ready: false, detail: 'not installed' }
  const ok = await commandSucceeds(bin, ['--version'])
  return { id: 'uv', label: 'uv (Python pkg manager)', ready: ok, detail: bin }
}

async function detectMcp(): Promise<ComponentStatus> {
  if (!existsSync(OPENCLAW_CONFIG)) {
    return { id: 'mcp', label: 'openclaw-mem0 MCP', ready: false, detail: 'openclaw.json missing' }
  }
  if (!existsSync(MCP_SOURCE_DIR)) {
    return { id: 'mcp', label: 'openclaw-mem0 MCP', ready: false, detail: `source dir missing at ${MCP_SOURCE_DIR}` }
  }
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const entry = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
    const registered = Boolean(entry?.command)
    return {
      id: 'mcp',
      label: 'openclaw-mem0 MCP',
      ready: registered,
      detail: registered ? 'registered in openclaw.json' : 'not registered',
    }
  } catch (err) {
    return { id: 'mcp', label: 'openclaw-mem0 MCP', ready: false, error: String(err) }
  }
}

export async function runInstall(progress: ProgressCallback): Promise<void> {
  const initial = await detectAll()
  for (const c of initial) {
    progress({ stage: 'check', step: c.id, message: `${c.label}: ${c.detail ?? (c.ready ? 'ready' : 'missing')}`, ready: c.ready })
  }

  if (!initial.find((c) => c.id === 'docker')!.ready) {
    progress({ stage: 'install', step: 'docker', message: 'installing docker via apt…' })
    try {
      await execFileAsync('sudo', ['-n', 'apt-get', 'install', '-y', 'docker.io'], { timeout: 120000, env: getServerEnv() })
      await execFileAsync('sudo', ['-n', 'usermod', '-aG', 'docker', process.env.USER ?? 'openclaw'], { env: getServerEnv() })
      progress({ stage: 'install', step: 'docker', message: 'docker installed', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'docker', message: `docker install failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  if (!initial.find((c) => c.id === 'ollama')!.ready) {
    progress({ stage: 'install', step: 'ollama', message: 'installing ollama (curl install script)…' })
    try {
      await execFileAsync('bash', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { timeout: 240000, env: getServerEnv() })
      progress({ stage: 'install', step: 'ollama', message: 'ollama installed', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'ollama', message: `ollama install failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  if (!initial.find((c) => c.id === 'bge-m3')!.ready) {
    progress({ stage: 'install', step: 'bge-m3', message: 'pulling bge-m3 model (~568 MB)…' })
    try {
      await execFileAsync('ollama', ['pull', 'bge-m3'], { timeout: 600000, env: getServerEnv() })
      progress({ stage: 'install', step: 'bge-m3', message: 'bge-m3 ready (1024d)', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'bge-m3', message: `bge-m3 pull failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  if (!initial.find((c) => c.id === 'qdrant')!.ready) {
    progress({ stage: 'install', step: 'qdrant', message: 'starting qdrant container…' })
    try {
      const dataPath = join(homedir(), '.openclaw', 'mem0-qdrant')
      await execFileAsync('mkdir', ['-p', dataPath], { env: getServerEnv() })
      // Try docker run; if a container with the name already exists, start it instead.
      try {
        await execFileAsync(
          'docker',
          [
            'run',
            '-d',
            '--name',
            'qdrant',
            '--restart=unless-stopped',
            '-p',
            '127.0.0.1:6333:6333',
            '-p',
            '127.0.0.1:6334:6334',
            '-v',
            `${dataPath}:/qdrant/storage`,
            'qdrant/qdrant:latest',
          ],
          { timeout: 240000, env: getServerEnv() },
        )
      } catch {
        await execFileAsync('docker', ['start', 'qdrant'], { env: getServerEnv() })
      }
      progress({ stage: 'install', step: 'qdrant', message: 'qdrant container started on :6333', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'qdrant', message: `qdrant start failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  if (!initial.find((c) => c.id === 'uv')!.ready) {
    progress({ stage: 'install', step: 'uv', message: 'installing uv (Astral)…' })
    try {
      await execFileAsync('bash', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], { timeout: 120000, env: getServerEnv() })
      progress({ stage: 'install', step: 'uv', message: 'uv installed', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'uv', message: `uv install failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  if (!initial.find((c) => c.id === 'mcp')!.ready) {
    progress({ stage: 'install', step: 'mcp', message: 'registering openclaw-mem0 MCP server in openclaw.json…' })
    try {
      const uvBin = (await which('uv')) ?? `${homedir()}/.local/bin/uv`
      const apiKey = readGoogleApiKey()
      const value = {
        command: uvBin,
        args: ['run', '--directory', MCP_SOURCE_DIR, 'python', 'server.py'],
        env: {
          MEM0_LLM_MODE: 'openai',
          MEM0_LLM_MODEL: 'gemini-2.5-flash-lite',
          OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
          OPENAI_API_KEY: apiKey ?? 'set-me-on-llm-provider-tab',
        },
      }
      await execFileAsync('openclaw', ['mcp', 'set', 'openclaw-mem0', JSON.stringify(value)], { timeout: 30000, env: getServerEnv() })
      progress({ stage: 'install', step: 'mcp', message: 'MCP server registered', ready: true })
    } catch (err: any) {
      progress({ stage: 'error', step: 'mcp', message: `mcp register failed: ${err?.stderr ?? err?.message}` })
      return
    }
  }

  progress({ stage: 'install', step: 'mcp', message: 'restarting gateway to load MCP…' })
  try {
    await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
  } catch (err: any) {
    progress({ stage: 'log', message: `gateway restart returned: ${err?.stderr ?? err?.message}` })
  }
  progress({ stage: 'done', message: 'install complete' })
}

function readGoogleApiKey(): string | null {
  try {
    const agentDir = join(homedir(), '.openclaw', 'agents', 'main', 'agent')
    // openclaw 2026.6.5+ keeps the raw key in the SQLite auth store; older
    // installs use auth-profiles.json. Match google by provider/`google:*` id
    // (the profile suffix changed from `:default` to `:manual`).
    const fromDb = readAuthStoreDb(join(agentDir, 'openclaw-agent.sqlite'))
    if (fromDb) return findProviderKey(fromDb, 'google')
    const jsonPath = join(agentDir, 'auth-profiles.json')
    if (!existsSync(jsonPath)) return null
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as ProfilesFile
    return findProviderKey(data, 'google')
  } catch {
    return null
  }
}
