import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let cachedPath: string | null = null
function augmentedPath(): string {
  if (cachedPath !== null) return cachedPath
  const home = os.homedir()
  const candidates = [
    // Dir of the node running THIS process. For nvm/Volta installs the managed
    // `openclaw` lives beside `node` here, so this must come FIRST — otherwise a
    // stale global (e.g. an old linuxbrew openclaw) wins and can mismatch the
    // gateway's install, which is what let the update button trigger a downgrade.
    path.dirname(process.execPath),
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
    // `--log-level silent` + `--no-color` suppress most banners, but openclaw
    // 2026.6.1+ still prints the clack "Doctor warnings" box to stdout for
    // `--status-json` subcommands. We strip it post-hoc via extractJson().
    const child = spawn('openclaw', ['--log-level', 'silent', '--no-color', ...args], {
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

/** Extract the first balanced JSON object/array from `s`, skipping any
 *  preceding noise (e.g. openclaw 2026.6.1's clack Doctor-warnings box).
 *  Throws if no top-level JSON value is found. */
function extractJson(s: string): unknown {
  const start = s.search(/[{[]/)
  if (start < 0) throw new Error(`no JSON value in output: ${s.slice(0, 80)}`)
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return JSON.parse(s.slice(start, i + 1))
    }
  }
  throw new Error(`unbalanced JSON in output: ${s.slice(start, start + 80)}`)
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
  const parsed = extractJson(r.stdout) as Record<string, unknown>
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
  const parsed = extractJson(r.stdout) as { models?: AvailableModel[] }
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

/** OpenClaw ≥2026.8.1 keeps per-agent config in the keyed map `agents.entries`;
 * older builds used the `agents.list` array. Both are read; writes go back in
 * whichever shape this OpenClaw actually uses. */
export type AgentsConfigShape = 'entries' | 'list'

type AgentEntryObject = Record<string, unknown>

function isPlainObject(v: unknown): v is AgentEntryObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function detectAgentsShape(agents: unknown): AgentsConfigShape {
  if (isPlainObject(agents) && isPlainObject(agents.entries)) return 'entries'
  // Legacy is also the safe default: pre-2026.8.1 builds reject agents.entries
  // outright, so a config with neither key must be written the old way.
  return 'list'
}

export function agentsToList(agents: unknown): AgentListEntry[] {
  if (!isPlainObject(agents)) return []
  if (isPlainObject(agents.entries)) {
    return Object.entries(agents.entries)
      .filter(([id]) => SAFE_AGENT_ID.test(id))
      .map(([id, e]) => ({
        id,
        model: isPlainObject(e) ? (e.model as AgentModelOverride | undefined) : undefined,
      }))
  }
  if (Array.isArray(agents.list)) {
    return (agents.list as Array<{ id?: string; model?: AgentModelOverride }>)
      .filter((e) => typeof e?.id === 'string' && SAFE_AGENT_ID.test(e.id))
      .map((e) => ({ id: e.id as string, model: e.model }))
  }
  return []
}

/** Compute the new value for the agents sub-path with one agent's model
 * override set (or removed, when `override` is undefined).
 *
 * Read-modify-write of the whole container is deliberate on both shapes:
 * entries carry per-agent config far beyond `model`, and rebuilding the map
 * from our reduced {id, model} view would delete it. It also keeps the agent
 * id out of the config path, so an id containing dots can't reach into
 * somewhere else in the config. */
export function applyAgentOverride(
  agents: unknown,
  agentId: string,
  override: AgentModelOverride | undefined,
): { path: string; value: unknown } {
  if (!SAFE_AGENT_ID.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
  const shape = detectAgentsShape(agents)
  const root = isPlainObject(agents) ? agents : {}

  if (shape === 'entries') {
    const entries = isPlainObject(root.entries) ? { ...root.entries } : {}
    const existing = isPlainObject(entries[agentId]) ? { ...entries[agentId] } : {}
    if (override === undefined) {
      if (!(agentId in entries)) return { path: 'agents.entries', value: entries }
      delete existing.model
    } else {
      existing.model = override
    }
    entries[agentId] = existing
    return { path: 'agents.entries', value: entries }
  }

  const list = Array.isArray(root.list)
    ? (root.list as AgentEntryObject[]).map((e) => (isPlainObject(e) ? { ...e } : e))
    : []
  const idx = list.findIndex((e) => isPlainObject(e) && e.id === agentId)
  if (override === undefined) {
    if (idx >= 0) delete (list[idx] as AgentEntryObject).model
  } else if (idx >= 0) {
    ;(list[idx] as AgentEntryObject).model = override
  } else {
    list.push({ id: agentId, model: override })
  }
  return { path: 'agents.list', value: list }
}

/** Read the whole `agents` object. Returns {} when this OpenClaw has no agents
 * config at all — including 2026.8.1's "Unknown config path", which the old
 * `not found`-only check mistook for a hard failure and turned into a 500. */
async function readAgentsConfig(): Promise<unknown> {
  const r = await runOpenclaw(['config', 'get', 'agents'])
  if (r.code !== 0) {
    if (/not found|unknown config path/i.test(r.stderr)) return {}
    throw new Error(`config get failed (${r.code}): ${r.stderr.trim()}`)
  }
  try {
    return extractJson(r.stdout)
  } catch {
    return {}
  }
}

export async function getAgentsList(): Promise<AgentListEntry[]> {
  return agentsToList(await readAgentsConfig())
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
  await writeAgentOverride(agentId, override)
}

export async function clearAgentModelOverride(agentId: string): Promise<void> {
  if (!SAFE_AGENT_ID.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
  await writeAgentOverride(agentId, undefined)
}

async function writeAgentOverride(
  agentId: string,
  override: AgentModelOverride | undefined,
): Promise<void> {
  const { path, value } = applyAgentOverride(await readAgentsConfig(), agentId, override)
  const r = await runOpenclaw(['config', 'set', path, JSON.stringify(value), '--strict-json'])
  if (r.code !== 0) throw new Error(`config set failed (${r.code}): ${r.stderr.trim()}`)
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
    const parsed = extractJson(r.stdout) as { primary?: string; fallbacks?: string[] }
    return {
      primary: parsed.primary ?? null,
      fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
    }
  } catch {
    return { primary: null, fallbacks: [] }
  }
}
