import { NextRequest, NextResponse } from 'next/server'
import { listMessages } from '@/lib/customer-service/cs-store'
import { suggestQuickReplies, readSuggestionCount, type HistoryMessage } from '@/lib/customer-service/quick-reply-llm'

export const runtime = 'nodejs'

interface SuggestBody {
  userId: string
  draft: string
}

export async function POST(req: NextRequest) {
  let body: SuggestBody
  try {
    body = (await req.json()) as SuggestBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.userId || typeof body.draft !== 'string') {
    return NextResponse.json({ error: 'userId and draft required' }, { status: 400 })
  }

  // Read the conversation tail so the LLM can match tone/language of
  // the real customer interaction.
  const recent = listMessages(body.userId, { limit: 20 }).slice(-12)
  const history: HistoryMessage[] = recent.map(m => ({
    direction: m.direction,
    text: m.text,
    type: m.type,
  }))

  const suggestions = await suggestQuickReplies({
    draft: body.draft,
    history,
    count: readSuggestionCount(),
  })
  return NextResponse.json({ suggestions })
}
