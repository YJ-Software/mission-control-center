/**
 * Switch the customer-service agent's memory backend between mem0 and
 * wiki-person modes. The switch happens by rewriting the AGENTS.md memory
 * section in the bound agent's workspace.
 *
 * Both modes assume the customer-id-injector plugin handles user_id
 * deterministically (so the LLM doesn't need to remember to pass userId).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const AGENTS_DIR = join(homedir(), '.openclaw', 'agents')

const BLOCK_START = '<!-- cs:memory-mode:start -->'
const BLOCK_END = '<!-- cs:memory-mode:end -->'

export type MemoryBackend = 'mem0' | 'wiki-person'

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

function buildWikiPersonBlock(): string {
  return [
    BLOCK_START,
    '',
    '### 客戶長期記憶（wiki person 頁面）',
    '',
    '🚨 **目前模式：wiki person 頁面 — 禁用 mem0 工具**',
    '即使 mem0 MCP tools (`search_memories`/`add_memory`/`list_memories` 等) 仍可呼叫，**這個 mode 一律不要用**。所有客戶長期記憶**必須**走 wiki person 頁面。如果你不小心呼叫了 mem0 tool，視為違反規則。',
    '',
    '每位 LINE 客戶在 wiki 有自己的 person entity 頁，路徑：`entity.customer-line-<userId>`',
    '（user_id 由 customer-id-injector plugin 自動注入到 wiki_get / wiki_apply call 上，不用煩惱）',
    '',
    '可用工具：',
    '- `wiki_get(id="entity.customer-line-<userId>")` — 載入客戶完整 profile',
    '- `wiki_apply(id, ops)` — 增/改 personCard 欄位 + claims',
    '- `wiki_search(query, scope="entities")` — 跨客戶搜尋（少用，正常情境用 wiki_get）',
    '',
    '**何時 wiki_get**：每則新客戶訊息開頭，先嘗試 `wiki_get(id="entity.customer-line-X")`',
    '- 命中 → 把 personCard + claims 當補充上下文',
    '- 沒命中（404）→ 用 `wiki_apply` 建一個 stub（見下方 schema）',
    '',
    '**Person 頁 schema**（建立時用）：',
    '```yaml',
    'pageType: entity',
    'entityType: person',
    'id: entity.customer-line-Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'canonicalId: line.Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'aliases: [Uxxxx...]',
    'privacyTier: confirm-before-use',
    'lastRefreshedAt: <ISO8601>',
    'personCard:',
    '  handles: [line:Uxxxx]',
    '  timezone: Asia/Taipei',
    '  lane: <一句話 routing hint>',
    '  askFor: [<用得上的 topic 列表>]',
    '  avoidAskingFor: [<該避開的 topic>]',
    '  confidence: 0.6',
    'claims:',
    '  - id: claim.<short>',
    '    text: <一句客觀事實>',
    '    status: supported',
    '    confidence: 0.8',
    '```',
    '',
    '**何時 wiki_apply（剛性規則 — 必須執行，不是建議）**：',
    '若客戶當前訊息**包含或揭露**以下任一類別，這一 turn 內**必須**呼叫 `wiki_apply` 把事實寫進 person 頁：',
    '- 偏好 → personCard 欄位（如 askFor / avoidAskingFor）',
    '- 身份／職業 → claims 加一條',
    '- 已詢問過的房型／服務 → claims 加一條',
    '- 重大決策 → claims 加一條',
    '- 投訴／特殊狀況 → claims 加一條（status: open）',
    '',
    '**判斷指引**：',
    '- 你回覆中只要重述了客戶說的任何事實（例如「您是設計師…」「您 4 人團隊…」「您詢問過 502…」），**那條就要 wiki_apply**。回覆裡寫得出來代表它對未來有用 → 必須存。',
    '- 一個 turn 可以呼叫多次 `wiki_apply`（每條獨立 fact 一個 op）。',
    '- 即使客戶訊息很短、沒新事實，**這個 turn 也要至少做一次 wiki_apply 更新 lastRefreshedAt**（讓我們知道你「來過」），或 explicitly 確認 entity 沒變動。',
    '- **不執行就是違反規則**。回覆完客戶後 → **下一個動作必須是 wiki_apply**（如果有事實）→ 然後才能結束 turn。',
    '',
    '**wiki_apply 操作格式**（範例）：',
    '```json',
    '{',
    '  "id": "entity.customer-line-<userId>",',
    '  "ops": [',
    '    { "op": "claims.append", "value": { "id": "claim.identity-designer", "text": "客戶是 UI/UX 設計師，4 人團隊", "status": "supported", "confidence": 0.9 } },',
    '    { "op": "personCard.set", "path": "lane", "value": "UI/UX 設計師團隊" }',
    '  ]',
    '}',
    '```',
    '（具體 ops 名稱以 wiki_apply 工具回傳的 schema 為準；不確定就先 claims.append 安全）',
    '',
    '**privacy**：個資（電話、Email、身分證）一律不寫進 wiki。需要傳給真人時，用 session 內訊息傳遞，不持久化。',
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
  // Inside the marker block, look at the section title — far more reliable
  // than a free-text grep that could trip on the "do not use other mode"
  // warning paragraphs.
  const block = content.slice(startIdx, endIdx)
  const mode: MemoryBackend = /###\s+客戶長期記憶（wiki person/.test(block) ? 'wiki-person' : 'mem0'
  return { agentId, agentsMdPath, blockPresent: true, mode }
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

// memory-wiki holds the memory slot in both modes — it provides the wiki
// knowledge-base supplement (search/digest in prompt) regardless. memory-lancedb
// is disabled outright (we use mem0 MCP for customer memory, lancedb's
// auto-recall would just add per-message latency for nothing).
//
// On mode switch we only toggle the agent's mem0 deny pattern: wiki-person
// mode glob-denies openclaw-mem0__* so the LLM literally can't call mem0 even
// if the prompt fails. before_tool_call hooks don't fire for MCP tools in
// OpenClaw 4.29, so config-level deny is the only working enforcement.
function patchOpenclawConfig(agentId: string, target: MemoryBackend): string {
  if (!existsSync(OPENCLAW_CONFIG)) return 'openclaw.json missing — skipped'
  const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8')
  const cfg = JSON.parse(raw) as Record<string, any>

  cfg.plugins ??= {}
  cfg.plugins.slots ??= {}
  cfg.plugins.slots.memory = 'memory-wiki'
  cfg.plugins.entries ??= {}
  cfg.plugins.entries['memory-lancedb'] = { ...(cfg.plugins.entries['memory-lancedb'] ?? {}), enabled: false }

  cfg.agents ??= {}
  const list: any[] = Array.isArray(cfg.agents.list) ? cfg.agents.list : []
  const idx = list.findIndex((a) => a?.id === agentId)
  if (idx >= 0) {
    const agent = list[idx]
    agent.tools ??= {}
    agent.tools.sandbox ??= {}
    agent.tools.sandbox.tools ??= {}
    const deny: string[] = Array.isArray(agent.tools.sandbox.tools.deny) ? agent.tools.sandbox.tools.deny : []
    const has = deny.includes(MEM0_DENY_PATTERN)
    if (target === 'wiki-person' && !has) deny.push(MEM0_DENY_PATTERN)
    if (target === 'mem0' && has) deny.splice(deny.indexOf(MEM0_DENY_PATTERN), 1)
    agent.tools.sandbox.tools.deny = deny
    list[idx] = agent
    cfg.agents.list = list
  }

  const next = JSON.stringify(cfg, null, 2) + '\n'
  if (next === raw) return 'openclaw.json unchanged'
  writeFileSync(OPENCLAW_CONFIG, next, 'utf-8')
  return `openclaw.json updated (slots.memory=memory-wiki, lancedb=disabled, mem0 deny=${target === 'wiki-person' ? 'on' : 'off'})`
}

export async function setMode(target: MemoryBackend): Promise<{ output: string; agentId: string | null }> {
  const status = getStatus()
  if (!status.agentId || !status.agentsMdPath) {
    throw new Error('No LINE-bound agent / AGENTS.md found')
  }
  const block = target === 'wiki-person' ? buildWikiPersonBlock() : buildMem0Block()
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

  const cfgOut = patchOpenclawConfig(status.agentId, target)

  let restartOut = ''
  try {
    const r = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
    restartOut = (r.stdout || '') + (r.stderr || '')
  } catch (err: any) {
    restartOut = err?.stderr ?? err?.message ?? ''
  }

  return {
    agentId: status.agentId,
    output: `wrote AGENTS.md memory section (mode=${target})\n${cfgOut}\n` + restartOut,
  }
}
