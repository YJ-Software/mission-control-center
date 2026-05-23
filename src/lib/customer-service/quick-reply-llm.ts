import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')

interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function readMem0Config(): LlmConfig | null {
  if (!existsSync(OPENCLAW_JSON)) return null
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8')) as {
      mcp?: { servers?: Record<string, { env?: Record<string, string> }> }
    }
    const env = cfg?.mcp?.servers?.['openclaw-mem0']?.env
    if (!env) return null
    const baseUrl = env.OPENAI_BASE_URL
    const apiKey = env.OPENAI_API_KEY
    const model = env.MEM0_LLM_MODEL ?? 'gemini-2.5-flash-lite'
    if (!baseUrl || !apiKey) return null
    return { baseUrl, apiKey, model }
  } catch {
    return null
  }
}

function readSetting(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? ''
}

/**
 * Resolve which LLM the quick-reply suggester should call.
 *
 * Default behaviour ("與 mem0 設定相同 LLM"): mirror the gemini-flash-lite
 * config from the openclaw-mem0 MCP entry — no second API key to manage.
 *
 * When the operator unchecks that toggle in CS Settings → Quick Reply
 * LLM, fields stored under `customer-service.quickReply.llm.*` take
 * over. Empty fields fall back to the mem0 entry so partial configs
 * still produce something workable.
 */
export function readLlmConfig(): LlmConfig | null {
  const useMem0 = (readSetting('customer-service.quickReply.llm.useMem0') || 'true') === 'true'
  const mem0 = readMem0Config()

  if (useMem0) return mem0

  const override: LlmConfig = {
    baseUrl: readSetting('customer-service.quickReply.llm.baseUrl') || mem0?.baseUrl || '',
    apiKey: readSetting('customer-service.quickReply.llm.apiKey') || mem0?.apiKey || '',
    model: readSetting('customer-service.quickReply.llm.model') || mem0?.model || 'gemini-2.5-flash-lite',
  }
  if (!override.baseUrl || !override.apiKey) return null
  return override
}

export interface HistoryMessage {
  direction: 'user' | 'bot' | 'operator' | string
  text: string | null
  type: string
}

const cache = new Map<string, { ts: number; suggestions: string[] }>()
const CACHE_TTL_MS = 60_000

function cacheKey(draft: string, history: HistoryMessage[]): string {
  const histHash = history.slice(-5).map(m => `${m.direction[0]}${(m.text ?? '').slice(0, 30)}`).join('|')
  return `${draft.trim().toLowerCase()}::${histHash}`
}

/**
 * Generate 3 short follow-up-button labels appropriate to attach as LINE
 * quick replies to the operator's pending message. Designed to be cheap
 * (gemini-flash-lite) and forgiving: if the LLM call fails for any
 * reason we return an empty array — the operator never sees an error,
 * they just don't get suggestions for that draft.
 */
export async function suggestQuickReplies(input: {
  draft: string
  history: HistoryMessage[]
}): Promise<string[]> {
  const llm = readLlmConfig()
  if (!llm) return []

  const draft = input.draft.trim()
  if (draft.length < 3) return []

  const ckey = cacheKey(draft, input.history)
  const cached = cache.get(ckey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.suggestions

  // Pick the most recent ~8 turns to give the LLM enough context for tone
  // and language without bloating the prompt.
  const recent = input.history.slice(-8)
    .filter(m => typeof m.text === 'string' && m.text.trim().length > 0)
    .map(m => {
      const role = m.direction === 'user' ? '客戶' : m.direction === 'operator' ? '客服' : 'bot'
      return `[${role}] ${m.text}`
    })
    .join('\n')

  const systemPrompt = `你是 LINE 客服 quick-reply 建議生成器。

任務：根據對話脈絡 + 客服將要送出的訊息，生成 3 個簡短的「客戶可能會想點」的快速回覆按鈕文字。

規則：
- 回 JSON object: { "suggestions": ["按鈕1", "按鈕2", "按鈕3"] }
- 每個按鈕最多 20 字（LINE quick reply 上限）
- 用客戶在歷史對話中使用的語言（中/英/日...）
- 簡短、口語化、像客戶自己會打的話
- 不要重複客服訊息中已有的選項
- 若上下文不夠，可以給通用「謝謝」「好的」「再聯絡」這類`

  const userPrompt = `對話歷史：
${recent || '(無歷史)'}

客服將要送出的訊息：
${draft}

請生成 3 個 quick reply 按鈕。`

  try {
    const res = await fetch(`${llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.7,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const errBody = await res.text()
      console.warn(`[quick-reply-llm] HTTP ${res.status}: ${errBody.slice(0, 200)}`)
      return []
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = body.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as { suggestions?: unknown }
    const list = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map(x => x.trim().slice(0, 20))
        .slice(0, 3)
      : []
    cache.set(ckey, { ts: Date.now(), suggestions: list })
    return list
  } catch (err) {
    console.warn('[quick-reply-llm] error:', err instanceof Error ? err.message : err)
    return []
  }
}
