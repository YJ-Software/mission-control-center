import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'

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

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runOpenclaw(args: string[], timeoutMs = 15000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('openclaw', args, {
      env: { ...process.env, PATH: augmentedPath() },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: stderr + `\n${err.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 0, stdout, stderr })
    })
  })
}

export interface ModelsStatus {
  configPath: string
  agentDir: string
  defaultModel: string | null
  resolvedDefault: string | null
  fallbacks: string[]
  aliases: Record<string, string>
  allowed: string[]
  imageModel: string | null
  imageFallbacks: string[]
}

export interface AvailableModel {
  key: string
  name: string
  input: string
  contextWindow: number
  local: boolean
  available: boolean
  tags: string[]
  missing: boolean
}

export async function getStatus(agent: string): Promise<ModelsStatus> {
  const r = await runOpenclaw(['models', '--agent', agent, '--status-json'])
  if (r.code !== 0) throw new Error(`models status failed (${r.code}): ${r.stderr.trim()}`)
  const parsed = JSON.parse(r.stdout) as Record<string, unknown>
  return {
    configPath: String(parsed.configPath ?? ''),
    agentDir: String(parsed.agentDir ?? ''),
    defaultModel: (parsed.defaultModel as string | null) ?? null,
    resolvedDefault: (parsed.resolvedDefault as string | null) ?? null,
    fallbacks: Array.isArray(parsed.fallbacks) ? (parsed.fallbacks as string[]) : [],
    aliases: (parsed.aliases as Record<string, string>) ?? {},
    allowed: Array.isArray(parsed.allowed) ? (parsed.allowed as string[]) : [],
    imageModel: (parsed.imageModel as string | null) ?? null,
    imageFallbacks: Array.isArray(parsed.imageFallbacks)
      ? (parsed.imageFallbacks as string[])
      : [],
  }
}

export async function listAvailable(agent: string): Promise<AvailableModel[]> {
  const r = await runOpenclaw(['models', '--agent', agent, 'list', '--json'])
  if (r.code !== 0) throw new Error(`models list failed (${r.code}): ${r.stderr.trim()}`)
  const parsed = JSON.parse(r.stdout) as { models?: AvailableModel[] }
  return parsed.models ?? []
}

function assertSafeModelId(model: string) {
  // Model ids look like `provider/name` (or alias). Allow letters / digits /
  // dash / underscore / dot / slash; reject leading "-" so it can't be reparsed
  // as a flag by openclaw's commander.
  if (
    typeof model !== 'string' ||
    model.length === 0 ||
    model.length > 256 ||
    model.startsWith('-') ||
    !/^[a-zA-Z0-9_./-]+$/.test(model)
  ) {
    throw new Error(`invalid model id: ${model}`)
  }
}

function assertSafeAlias(alias: string) {
  if (
    typeof alias !== 'string' ||
    alias.length === 0 ||
    alias.length > 64 ||
    alias.startsWith('-') ||
    !/^[a-zA-Z0-9_.-]+$/.test(alias)
  ) {
    throw new Error(`invalid alias: ${alias}`)
  }
}

// Note: `openclaw models set` only updates the GLOBAL default; it rejects
// --agent. Per-agent overrides exist but require manual agent-config edits.
export async function setDefault(_agent: string, model: string): Promise<void> {
  assertSafeModelId(model)
  const r = await runOpenclaw(['models', 'set', model])
  if (r.code !== 0) throw new Error(`models set failed (${r.code}): ${r.stderr.trim()}`)
}

export async function addFallback(agent: string, model: string): Promise<void> {
  assertSafeModelId(model)
  const r = await runOpenclaw(['models', '--agent', agent, 'fallbacks', 'add', model])
  if (r.code !== 0) throw new Error(`fallbacks add failed (${r.code}): ${r.stderr.trim()}`)
}

export async function removeFallback(agent: string, model: string): Promise<void> {
  assertSafeModelId(model)
  const r = await runOpenclaw(['models', '--agent', agent, 'fallbacks', 'remove', model])
  if (r.code !== 0) throw new Error(`fallbacks remove failed (${r.code}): ${r.stderr.trim()}`)
}

export async function reorderFallbacks(agent: string, models: string[]): Promise<void> {
  for (const m of models) assertSafeModelId(m)
  // No native "set list" command — clear then re-add in order.
  const clear = await runOpenclaw(['models', '--agent', agent, 'fallbacks', 'clear'])
  if (clear.code !== 0) throw new Error(`fallbacks clear failed (${clear.code}): ${clear.stderr.trim()}`)
  for (const m of models) {
    const r = await runOpenclaw(['models', '--agent', agent, 'fallbacks', 'add', m])
    if (r.code !== 0) throw new Error(`fallbacks add failed for ${m}: ${r.stderr.trim()}`)
  }
}

export async function addAlias(agent: string, alias: string, model: string): Promise<void> {
  assertSafeAlias(alias)
  assertSafeModelId(model)
  const r = await runOpenclaw(['models', '--agent', agent, 'aliases', 'add', alias, model])
  if (r.code !== 0) throw new Error(`alias add failed (${r.code}): ${r.stderr.trim()}`)
}

export async function removeAlias(agent: string, alias: string): Promise<void> {
  assertSafeAlias(alias)
  const r = await runOpenclaw(['models', '--agent', agent, 'aliases', 'remove', alias])
  if (r.code !== 0) throw new Error(`alias remove failed (${r.code}): ${r.stderr.trim()}`)
}

// ── per-agent overrides ───────────────────────────────────────────────────
// Per OpenClaw schema (docs.openclaw.ai/gateway/config-agents), per-agent
// model config lives at `agents.list[i].model` in openclaw.json. The CLI
// `models set / fallbacks add` commands only touch the global defaults; to
// override per agent we go through `openclaw config set agents.list[<idx>].model …`.

export interface AgentModelOverride {
  primary?: string
  fallbacks?: string[]
}

export interface AgentListEntry {
  id: string
  model?: AgentModelOverride
}

const SAFE_AGENT_ID = /^[a-zA-Z0-9_.-]+$/

export async function getAgentsList(): Promise<AgentListEntry[]> {
  const r = await runOpenclaw(['config', 'get', 'agents.list'])
  if (r.code !== 0) {
    // Fresh openclaw.json doesn't have agents.list until something writes it.
    if (r.stderr.includes('not found')) return []
    throw new Error(`config get failed (${r.code}): ${r.stderr.trim()}`)
  }
  let parsed: Array<{ id?: string; model?: AgentModelOverride }>
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((e) => typeof e?.id === 'string' && SAFE_AGENT_ID.test(e.id))
    .map((e) => ({ id: e.id as string, model: e.model }))
}

async function writeAgentsList(list: AgentListEntry[]): Promise<void> {
  const r = await runOpenclaw([
    'config',
    'set',
    'agents.list',
    JSON.stringify(list),
    '--strict-json',
  ])
  if (r.code !== 0) throw new Error(`config set failed (${r.code}): ${r.stderr.trim()}`)
}

export async function setAgentModelOverride(
  agentId: string,
  override: AgentModelOverride,
): Promise<void> {
  if (!SAFE_AGENT_ID.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
  // Validate each model id the same way globally to defang argv smuggling.
  if (override.primary !== undefined) assertSafeModelId(override.primary)
  if (override.fallbacks !== undefined) {
    if (!Array.isArray(override.fallbacks)) throw new Error('fallbacks must be an array')
    for (const m of override.fallbacks) assertSafeModelId(m)
  }
  // Read-modify-write the whole agents.list because `config set` replaces
  // array indexes only when the agent is already in the list; on a fresh
  // openclaw.json with no agents.list we'd otherwise have no target index.
  const list = await getAgentsList()
  const idx = list.findIndex((e) => e.id === agentId)
  if (idx >= 0) {
    list[idx] = { ...list[idx], model: override }
  } else {
    list.push({ id: agentId, model: override })
  }
  await writeAgentsList(list)
}

export async function clearAgentModelOverride(agentId: string): Promise<void> {
  if (!SAFE_AGENT_ID.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
  const list = await getAgentsList()
  const idx = list.findIndex((e) => e.id === agentId)
  if (idx < 0) return // already absent — no-op
  const next = { ...list[idx] }
  delete next.model
  list[idx] = next
  await writeAgentsList(list)
}

/** Read the TRUE global defaults (agents.defaults.model) from openclaw.json,
 * not the per-agent effective view (which `openclaw models status` returns).
 * Used by the "Global defaults" tab so reorder/set writes match what's shown. */
export async function getGlobalDefaults(): Promise<{
  primary: string | null
  fallbacks: string[]
}> {
  const r = await runOpenclaw(['config', 'get', 'agents.defaults.model'])
  if (r.code !== 0) {
    if (r.stderr.includes('not found')) return { primary: null, fallbacks: [] }
    throw new Error(`config get failed (${r.code}): ${r.stderr.trim()}`)
  }
  try {
    const parsed = JSON.parse(r.stdout) as { primary?: string; fallbacks?: string[] }
    return {
      primary: parsed.primary ?? null,
      fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
    }
  } catch {
    return { primary: null, fallbacks: [] }
  }
}
