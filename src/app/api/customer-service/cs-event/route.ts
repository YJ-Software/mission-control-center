import { NextRequest, NextResponse } from 'next/server'
import { recordMessage, maybeRefreshProfile, type Direction, type MessageType } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

interface CsEventBody {
  userId: string
  direction: Direction          // 'user' | 'bot' | 'operator'
  type?: MessageType
  text?: string | null
  payload?: unknown
  lineMessageId?: string | null
  operatorId?: string | null
  channelId?: string | null
}

/**
 * Posted by the business-hours-gate plugin (and other future producers) to
 * record a LINE event into the conversations log. The plugin fires this
 * fire-and-forget so failures here do not block the agent turn.
 */
export async function POST(req: NextRequest) {
  let body: CsEventBody
  try {
    body = (await req.json()) as CsEventBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.userId || !body.direction) {
    return NextResponse.json({ error: 'userId and direction required' }, { status: 400 })
  }

  const stored = recordMessage({
    userId: body.userId,
    direction: body.direction,
    type: body.type ?? 'text',
    text: body.text ?? undefined,
    payload: body.payload,
    lineMessageId: body.lineMessageId ?? undefined,
    operatorId: body.operatorId ?? undefined,
  })

  // First-sighting profile fetch (no-op if recent)
  void maybeRefreshProfile(body.userId).catch(() => {})

  return NextResponse.json({ ok: true, id: stored.id })
}
