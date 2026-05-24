/**
 * Handoff catch-up: when an operator's pause window ends (auto or manual),
 * scan the conversation that happened during the handoff and let the LLM
 * pull out durable customer facts worth persisting into mem0.
 *
 * Lightweight by design — no agent, no MCP roundtrip beyond mem0's add tool.
 * Reuses the same Gemini config the Quick Reply suggester uses (default:
 * borrowed from openclaw-mem0 MCP env), so operators don't manage a second
 * key. Completely best-effort: any failure is logged and swallowed so the
 * resume path itself never breaks.
 */

import { listMessages, getConversation } from './cs-store'
import { readLlmConfig } from './quick-reply-llm'
import { addMemory } from './mem0-cli'
import { emitBus } from '@/lib/event-bus'
import { createNotification } from '@/lib/notifications'

interface Fact {
  text: string
  category?: string
}

const MIN_MESSAGES = 2
const MAX_MESSAGES = 60

export async function extractHandoffMemories(
  userId: string,
  sinceSec: number,
): Promise<{ extracted: number; skipped: boolean; error?: string }> {
  try {
    const all = listMessages(userId, { limit: 200 })
    const inWindow = all
      .filter(m => (m.createdAt ?? 0) >= sinceSec)
      .filter(m => m.direction === 'user' || m.direction === 'operator')
      .filter(m => m.type === 'text' || m.type === 'file')
      .filter(m => typeof m.text === 'string' && m.text.trim().length > 0)
      .slice(-MAX_MESSAGES)

    if (inWindow.length < MIN_MESSAGES) {
      return { extracted: 0, skipped: true }
    }

    const customerLines = inWindow.filter(m => m.direction === 'user').length
    if (customerLines === 0) {
      return { extracted: 0, skipped: true }
    }

    const llm = readLlmConfig()
    if (!llm) {
      console.warn('[handoff-memory] no LLM configured; skip extraction for', userId)
      return { extracted: 0, skipped: true, error: 'no-llm' }
    }

    const transcript = inWindow
      .map(m => {
        const role = m.direction === 'user' ? '客戶' : '客服'
        return `[${role}] ${m.text}`
      })
      .join('\n')

    const systemPrompt = `你是一個客服對話的「長期記憶萃取器」。
讀完一段客服接手客戶的對話後，你的工作是挑出值得長期記憶的「客戶事實」——
未來其他 session 看到這位客戶時，知道這些事會更會服務他。

挑選原則：
- 客戶身份、職業、家庭、地點、偏好、過敏、特殊需求
- 客戶承諾或宣告的計畫（要訂房、要回流、不再合作⋯）
- 客戶在乎的限制或標準（必須電梯、不能寵物、預算上限⋯）
- 客服已答應或承諾的條件（給予折扣、保留房、優先處理⋯）

不要記錄：
- 一次性、會過時的對話內容（今天天氣、剛才那句問候）
- 客服的客套話、招呼
- 已經失效或被取消的內容

輸出格式：JSON object { "facts": [{"text": "客戶簡短事實", "category": "identity|preference|commitment|constraint|other"}] }
- 每條 facts.text 用中性第三人稱、20-60 字
- facts 可以是 0 條（這段對話真的沒有值得記的）
- 最多 8 條`

    const userPrompt = `對話內容：
${transcript}

請挑出值得長期記住的客戶事實。`

    const res = await fetch(`${llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      const body = await res.text()
      const msg = `LLM HTTP ${res.status}: ${body.slice(0, 200)}`
      console.warn('[handoff-memory]', msg)
      return { extracted: 0, skipped: false, error: msg }
    }

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const raw = body.choices?.[0]?.message?.content ?? ''
    let parsed: { facts?: Fact[] }
    try {
      parsed = JSON.parse(raw) as { facts?: Fact[] }
    } catch {
      console.warn('[handoff-memory] non-json LLM output:', raw.slice(0, 200))
      return { extracted: 0, skipped: false, error: 'parse-fail' }
    }

    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
        .filter((f): f is Fact => f && typeof f.text === 'string' && f.text.trim().length > 0)
        .slice(0, 8)
      : []

    if (facts.length === 0) {
      return { extracted: 0, skipped: false }
    }

    let ok = 0
    const errors: string[] = []
    for (const f of facts) {
      try {
        await addMemory(userId, f.text.trim(), {
          source: 'handoff',
          category: f.category ?? 'other',
          windowFrom: sinceSec,
          windowTo: Math.floor(Date.now() / 1000),
        })
        ok++
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    emitBus({
      type: 'cs:handoff-memories-extracted',
      payload: { userId, count: ok, errors: errors.length },
    })

    if (ok > 0) {
      const conv = getConversation(userId)
      const who = conv?.displayName || userId.slice(0, 8)
      createNotification({
        type: 'system',
        severity: 'info',
        title: `已從接手對話沉澱 ${ok} 條客戶記憶`,
        body: `客戶：${who}`,
      })
    }

    if (errors.length > 0) {
      console.warn('[handoff-memory] addMemory errors for', userId, errors.slice(0, 3))
    }
    return { extracted: ok, skipped: false, error: errors[0] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[handoff-memory] unexpected error for', userId, msg)
    return { extracted: 0, skipped: false, error: msg }
  }
}
