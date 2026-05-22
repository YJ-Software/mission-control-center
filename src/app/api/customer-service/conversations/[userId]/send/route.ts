import { NextRequest, NextResponse } from 'next/server'
import { recordMessage, setPause } from '@/lib/customer-service/cs-store'
import { scheduleAutoResume } from '@/lib/customer-service/cs-resume-timers'
import { pushMessage, buildTextMessage, buildImageMessage, type LineMessage } from '@/lib/customer-service/line-api'

export const runtime = 'nodejs'

const PAUSE_MS = 30 * 60 * 1000

interface SendBody {
  type: 'text' | 'image'
  text?: string
  imageUrl?: string
  previewImageUrl?: string
  quickReplies?: string[]
  operatorId?: string
  /** When true (default), starts/refreshes the 30-min agent pause window. */
  takeover?: boolean
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  let body: SendBody
  try {
    body = (await req.json()) as SendBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Build the LINE message
  let msg: LineMessage
  if (body.type === 'image') {
    if (!body.imageUrl) return NextResponse.json({ error: 'imageUrl required for image type' }, { status: 400 })
    msg = buildImageMessage(body.imageUrl, body.previewImageUrl)
  } else {
    const t = (body.text ?? '').trim()
    if (!t) return NextResponse.json({ error: 'text required' }, { status: 400 })
    msg = buildTextMessage(t, body.quickReplies)
  }

  let lineMessageId: string | undefined
  try {
    const r = await pushMessage(userId, [msg])
    lineMessageId = r.sentMessages?.[0]?.id
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }

  // Persist locally
  const stored = recordMessage({
    userId,
    direction: 'operator',
    type: body.type,
    text: body.type === 'text' ? body.text : undefined,
    payload: body.type === 'image'
      ? { imageUrl: body.imageUrl, previewImageUrl: body.previewImageUrl }
      : body.quickReplies && body.quickReplies.length > 0
        ? { quickReplies: body.quickReplies }
        : undefined,
    lineMessageId,
    operatorId: body.operatorId,
  })

  // Operator activity → reset 30-min pause window (unless explicitly opted out).
  if (body.takeover !== false) {
    const pause = setPause(userId, PAUSE_MS, body.operatorId)
    scheduleAutoResume(userId, pause.resumeAt)
  }

  return NextResponse.json({ ok: true, message: stored })
}
