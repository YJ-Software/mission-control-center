/**
 * Apply the mem0 memory-mode block to the customer-service agent's AGENTS.md.
 *
 * Earlier revisions supported a second "wiki-person" mode that wrote a
 * different prompt block and toggled an MCP deny pattern. That mode was
 * removed because the underlying wiki tools were never exposed to the agent
 * model in the OpenClaw versions we ship.
 *
 * customer-id-injector handles user_id deterministically, so the LLM doesn't
 * need to remember to pass userId.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'
import { applyPurposeToConfig, PURPOSE_KEY } from '@/lib/wiki/purpose'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const AGENTS_DIR = join(homedir(), '.openclaw', 'agents')

const BLOCK_START = '<!-- cs:memory-mode:start -->'
const BLOCK_END = '<!-- cs:memory-mode:end -->'

export type MemoryBackend = 'mem0'

export interface MemoryBackendStatus {
  agentId: string | null
  agentsMdPath: string | null
  blockPresent: boolean
  mode: MemoryBackend | 'unknown'
}

function discoverLineAgentId(): string | null {
  if (!existsSync(OPENCLAW_CONFIG)) return null
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const bindings: any[] = Array.isArray(cfg?.bindings) ? cfg.bindings : []
    for (const b of bindings) {
      if (b?.match?.channel === 'line' && typeof b?.agentId === 'string') return b.agentId
    }
  } catch {
    /* ignore */
  }
  if (!existsSync(AGENTS_DIR)) return null
  try {
    const dirs = readdirSync(AGENTS_DIR).filter((d) => d !== 'main')
    if (dirs.length > 0) return dirs[0]
  } catch {
    /* ignore */
  }
  return null
}

function workspacePathFor(agentId: string): string | null {
  if (!existsSync(OPENCLAW_CONFIG)) return null
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const list: any[] = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : []
    const entry = list.find((a) => a?.id === agentId)
    if (entry?.workspace && typeof entry.workspace === 'string') return entry.workspace
  } catch {
    /* ignore */
  }
  return join(homedir(), '.openclaw', 'workspaces', agentId)
}

function buildMem0Block(): string {
  return [
    BLOCK_START,
    '',
    '### 客戶長期記憶（mem0 via openclaw-mem0 MCP）',
    '',
    '🚨 **目前模式：mem0 — 不要使用 wiki person 頁面工具存客戶記憶**',
    '即使 wiki tools (`wiki_apply`/`wiki_get` 對 entity.customer-line-* 路徑) 可用，**這個 mode 一律不要用來存客戶 profile**。所有客戶長期記憶**必須**走 mem0。wiki tools 只用來查事業知識（借址登記、房型等），不要對客戶 entity 寫入。',
    '',
    '我有一組 `mem0` 工具可以記錄／回憶**特定客戶**的歷史（跨 session、跨日子）：',
    '',
    '- `search_memories(query, user_id, limit)` — 用語意搜尋客戶記憶',
    '- `add_memory(content, user_id, metadata?)` — 新增一條客戶記憶',
    '- `list_memories(user_id, limit)` — 列出該客戶所有記憶',
    '- `delete_memory(memory_id)` — 刪一條',
    '- `delete_all_memories(user_id)` — 全清',
    '',
    '**user_id 由 customer-id-injector plugin 自動注入**，從目前的 LINE session key 拿正確的 senderId。即使我傳錯 user_id，plugin 會強制覆寫成正確的。但我還是該寫對讓 prompt 更清楚。',
    '',
    '**何時 search**：每則新客戶訊息開頭，先 `search_memories(query=客戶這次的問題, user_id=該客戶的 LINE userId, limit=5)`，把命中的記憶當補充上下文。命中分數 < 0.4 的可以忽略。',
    '',
    '**何時 add（剛性規則 — 必須執行）**：',
    '若客戶當前訊息**包含或揭露**以下任一類別，**這一 turn 內必須**至少呼叫一次 `add_memory`：',
    '- 偏好（時段、方案類型、聯絡方式）',
    '- 身份（職業、產業、團隊規模）',
    '- 已詢問過的房型／服務',
    '- 重大決策（要租 / 要看 / 要等 / 婉拒過）',
    '- 投訴 / 特殊狀況',
    '',
    '**判斷指引**：你回覆中只要重述了客戶說的任何事實（「您是設計師…」「您偏好下午…」），那條就要 add。一個 turn 可以呼叫多次 add_memory。',
    '',
    '**不要 add**：純 chitchat、機密／個資（電話、Email、身分證）、暫時性疑問、發牢騷。',
    '',
    '**內容格式**：用第三人稱、客觀事實。不要存對話原文。',
    '',
    BLOCK_END,
  ].join('\n')
}

export function getStatus(): MemoryBackendStatus {
  const agentId = discoverLineAgentId()
  if (!agentId) return { agentId: null, agentsMdPath: null, blockPresent: false, mode: 'unknown' }
  const ws = workspacePathFor(agentId)
  const agentsMdPath = ws ? join(ws, 'AGENTS.md') : null
  if (!agentsMdPath || !existsSync(agentsMdPath)) {
    return { agentId, agentsMdPath, blockPresent: false, mode: 'unknown' }
  }
  const content = readFileSync(agentsMdPath, 'utf-8')
  const startIdx = content.indexOf(BLOCK_START)
  const endIdx = content.indexOf(BLOCK_END)
  const blockPresent = startIdx >= 0 && endIdx > startIdx
  if (!blockPresent) {
    // Heuristic for legacy AGENTS.md without our markers — check the whole file.
    if (/openclaw-mem0|search_memories|add_memory/.test(content)) {
      return { agentId, agentsMdPath, blockPresent: false, mode: 'mem0' }
    }
    return { agentId, agentsMdPath, blockPresent: false, mode: 'unknown' }
  }
  return { agentId, agentsMdPath, blockPresent: true, mode: 'mem0' }
}

function stripLegacyMemorySection(content: string): string {
  // Drop the unmarked legacy "### 客戶長期記憶" section (added by hand before
  // this page existed). Heading match → cut up to the next h2/h3 boundary.
  const headingRe = /^###\s+(客戶長期記憶|Customer long-term memory|Long-term customer memory)/m
  const m = headingRe.exec(content)
  if (!m) return content
  const start = m.index
  const after = content.slice(start + m[0].length)
  const nextRe = /^(##\s|###\s)/m
  const nextMatch = nextRe.exec(after)
  const end = nextMatch ? start + m[0].length + nextMatch.index : content.length
  return (content.slice(0, start) + content.slice(end)).replace(/\n{3,}/g, '\n\n')
}

const MEM0_DENY_PATTERN = 'openclaw-mem0__*'

// Customer-service purpose: the plugin block (slot / lancedb / wiki search) is
// owned by the shared purpose resolver so this flow can never disagree with the
// second-brain setup flow. Under purpose 'customer-service', slot=memory-wiki
// (its knowledge digest is injected into the agent prompt) and lancedb is
// DISABLED — OpenClaw disables a non-slot memory plugin anyway, so there's no
// semantic-search benefit to keeping it on. Customer profiles go through mem0.
//
// On top of the shared plugin block, customer-service also clears the legacy
// mem0 deny pattern from the bound agent's sandbox so it regains the
// openclaw-mem0__* tools.
function patchOpenclawConfig(agentId: string): string {
  if (!existsSync(OPENCLAW_CONFIG)) return 'openclaw.json missing — skipped'
  const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8')
  const cfg = JSON.parse(raw) as Record<string, any>

  // Shared, conflict-free plugin config for the customer-service purpose.
  applyPurposeToConfig(cfg, 'customer-service')

  cfg.agents ??= {}
  const list: any[] = Array.isArray(cfg.agents.list) ? cfg.agents.list : []
  const idx = list.findIndex((a) => a?.id === agentId)
  if (idx >= 0) {
    const agent = list[idx]
    const deny: string[] = Array.isArray(agent?.tools?.sandbox?.tools?.deny)
      ? agent.tools.sandbox.tools.deny
      : []
    const denyIdx = deny.indexOf(MEM0_DENY_PATTERN)
    if (denyIdx >= 0) {
      deny.splice(denyIdx, 1)
      agent.tools.sandbox.tools.deny = deny
      list[idx] = agent
      cfg.agents.list = list
    }
  }

  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')

  // Persist the choice so the rest of the app (and the second-brain Wiki page)
  // agrees this machine is now in customer-service mode.
  db.insert(settings)
    .values({ key: PURPOSE_KEY, value: 'customer-service' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'customer-service' } })
    .run()

  return 'openclaw.json updated (purpose=customer-service: lancedb auto-recall off, mem0 deny cleared)'
}

export async function setMode(): Promise<{ output: string; agentId: string | null }> {
  const status = getStatus()
  if (!status.agentId || !status.agentsMdPath) {
    throw new Error('No LINE-bound agent / AGENTS.md found')
  }
  const block = buildMem0Block()
  let content = readFileSync(status.agentsMdPath, 'utf-8')

  if (status.blockPresent) {
    const startIdx = content.indexOf(BLOCK_START)
    const endIdx = content.indexOf(BLOCK_END)
    if (startIdx >= 0 && endIdx > startIdx) {
      content = content.slice(0, startIdx) + block + content.slice(endIdx + BLOCK_END.length)
    }
  } else {
    // First-time switch — strip any legacy unmarked memory section first so
    // the agent doesn't see two contradictory blocks.
    content = stripLegacyMemorySection(content)
    const anchor = '## Red Lines'
    const idx = content.indexOf(anchor)
    if (idx > 0) {
      content = content.slice(0, idx) + block + '\n\n' + content.slice(idx)
    } else {
      content = content.trimEnd() + '\n\n' + block + '\n'
    }
  }

  writeFileSync(status.agentsMdPath, content, 'utf-8')

  const cfgOut = patchOpenclawConfig(status.agentId)

  let restartOut = ''
  try {
    const r = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
    restartOut = (r.stdout || '') + (r.stderr || '')
  } catch (err: any) {
    restartOut = err?.stderr ?? err?.message ?? ''
  }

  return {
    agentId: status.agentId,
    output: `wrote AGENTS.md memory section (mode=mem0)\n${cfgOut}\n` + restartOut,
  }
}
