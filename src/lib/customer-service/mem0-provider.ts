import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

export type ProviderMode = 'openai' | 'gemini' | 'ollama'

export interface ProviderConfig {
  mode: ProviderMode
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxTokens: number
}

export interface ProviderStatus {
  registered: boolean
  config: ProviderConfig
  hasApiKey: boolean
}

const DEFAULTS: Record<ProviderMode, Partial<ProviderConfig>> = {
  openai: {
    model: 'gemini-2.5-flash-lite',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  gemini: {
    model: 'gemini-2.5-flash-lite',
    baseUrl: '',
  },
  ollama: {
    model: 'qwen3:8b',
    baseUrl: 'http://127.0.0.1:11434',
  },
}

export function getProviderStatus(): ProviderStatus {
  const empty: ProviderConfig = {
    mode: 'openai',
    model: DEFAULTS.openai.model ?? '',
    baseUrl: DEFAULTS.openai.baseUrl ?? '',
    apiKey: '',
    temperature: 0.1,
    maxTokens: 2000,
  }
  if (!existsSync(OPENCLAW_CONFIG)) {
    return { registered: false, config: empty, hasApiKey: false }
  }
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const entry = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
    if (!entry) return { registered: false, config: empty, hasApiKey: false }
    const env = (entry.env ?? {}) as Record<string, string>
    const mode = (env.MEM0_LLM_MODE ?? 'openai').toLowerCase() as ProviderMode
    const config: ProviderConfig = {
      mode,
      model: env.MEM0_LLM_MODEL ?? DEFAULTS[mode]?.model ?? '',
      baseUrl: env.OPENAI_BASE_URL ?? DEFAULTS[mode]?.baseUrl ?? '',
      apiKey: env.OPENAI_API_KEY ?? env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY ?? '',
      temperature: Number(env.MEM0_LLM_TEMPERATURE ?? '0.1'),
      maxTokens: Number(env.MEM0_LLM_MAX_TOKENS ?? '2000'),
    }
    return {
      registered: true,
      config: { ...config, apiKey: maskApiKey(config.apiKey) },
      hasApiKey: config.apiKey.length > 0,
    }
  } catch {
    return { registered: false, config: empty, hasApiKey: false }
  }
}

export async function setProvider(input: ProviderConfig): Promise<{ output: string }> {
  if (!existsSync(OPENCLAW_CONFIG)) {
    throw new Error('openclaw.json not found')
  }
  const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
  const existing = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
  if (!existing) throw new Error('mcp.servers.openclaw-mem0 not registered — run install wizard first')

  const env: Record<string, string> = {
    ...(existing.env ?? {}),
    MEM0_LLM_MODE: input.mode,
    MEM0_LLM_MODEL: input.model,
    MEM0_LLM_TEMPERATURE: String(input.temperature),
    MEM0_LLM_MAX_TOKENS: String(input.maxTokens),
  }

  if (input.mode === 'openai') {
    env.OPENAI_BASE_URL = input.baseUrl || DEFAULTS.openai.baseUrl!
    if (input.apiKey && !input.apiKey.includes('***')) env.OPENAI_API_KEY = input.apiKey
    delete env.GOOGLE_API_KEY
    delete env.GEMINI_API_KEY
  } else if (input.mode === 'gemini') {
    if (input.apiKey && !input.apiKey.includes('***')) env.GOOGLE_API_KEY = input.apiKey
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_KEY
  } else if (input.mode === 'ollama') {
    env.OLLAMA_BASE_URL = input.baseUrl || DEFAULTS.ollama.baseUrl!
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_KEY
    delete env.GOOGLE_API_KEY
    delete env.GEMINI_API_KEY
  }

  const value = { ...existing, env }
  const out = await execFileAsync(
    'openclaw',
    ['mcp', 'set', 'openclaw-mem0', JSON.stringify(value)],
    { timeout: 30000, env: getServerEnv() },
  )
  return { output: (out.stdout || '') + (out.stderr || '') }
}

export async function testProvider(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    const status = getProviderStatus()
    const entry = readMcpEntry()
    if (!entry) return { ok: false, latencyMs: 0, error: 'mcp server not registered' }

    const env = (entry.env ?? {}) as Record<string, string>
    const mode = (env.MEM0_LLM_MODE ?? 'openai').toLowerCase() as ProviderMode
    const model = env.MEM0_LLM_MODEL ?? ''

    if (mode === 'openai') {
      const baseUrl = env.OPENAI_BASE_URL ?? ''
      const apiKey = env.OPENAI_API_KEY ?? env.GOOGLE_API_KEY ?? ''
      if (!apiKey) return { ok: false, latencyMs: 0, error: 'no api key configured' }
      const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      })
      const ms = Date.now() - t0
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return { ok: false, latencyMs: ms, error: `${res.status}: ${txt.slice(0, 200)}` }
      }
      return { ok: true, latencyMs: ms }
    }

    if (mode === 'gemini') {
      const apiKey = env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY ?? ''
      if (!apiKey) return { ok: false, latencyMs: 0, error: 'no api key configured' }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      })
      const ms = Date.now() - t0
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return { ok: false, latencyMs: ms, error: `${res.status}: ${txt.slice(0, 200)}` }
      }
      return { ok: true, latencyMs: ms }
    }

    if (mode === 'ollama') {
      const baseUrl = env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
      const ms = Date.now() - t0
      if (!res.ok) return { ok: false, latencyMs: ms, error: `${res.status}` }
      return { ok: true, latencyMs: ms }
    }

    return { ok: false, latencyMs: 0, error: `unknown mode: ${status.config.mode}` }
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - t0, error: err?.message ?? String(err) }
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

function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return '***'
  return key.slice(0, 6) + '***' + key.slice(-4)
}

export async function restartGateway(): Promise<string> {
  try {
    const out = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
    return (out.stdout || '') + (out.stderr || '')
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}
