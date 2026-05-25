import { NextRequest, NextResponse } from 'next/server'
import { recordMessage, setPause } from '@/lib/customer-service/cs-store'
import { scheduleAutoResume } from '@/lib/customer-service/cs-resume-timers'
import { pushMessage, buildTextMessage, buildImageMessage, buildStickerMessage, type LineMessage } from '@/lib/customer-service/line-api'

export const runtime = 'nodejs'

const PAUSE_MS = 30 * 60 * 1000

interface SendBody {
  type: 'text' | 'image' | 'file' | 'sticker'
  text?: string
  imageUrl?: string
  previewImageUrl?: string
  /** For type=file: public URL we built at upload time + the original
   *  filename, so we can compose a "📎 contract.pdf  https://..." text. */
  fileUrl?: string
  fileName?: string
  /** For type=sticker: LINE packageId + stickerId from the official
   *  sendable sticker list. */
  packageId?: string
  stickerId?: string
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
  } else if (body.type === 'sticker') {
    if (!body.packageId || !body.stickerId) {
      return NextResponse.json({ error: 'packageId and stickerId required for sticker type' }, { status: 400 })
    }
    msg = buildStickerMessage(body.packageId, body.stickerId)
  } else if (body.type === 'file') {
    // LINE has no native file-message type; wrap as text with the public
    // URL so the customer can tap to download. Operator can prefix custom
    // text via body.text — if blank we autogenerate "📎 <name>\n<url>".
    if (!body.fileUrl) return NextResponse.json({ error: 'fileUrl required for file type' }, { status: 400 })
    const name = body.fileName ?? 'file'
    const lead = (body.text ?? '').trim()
    const composed = lead
      ? `${lead}\n\n📎 ${name}\n${body.fileUrl}`
      : `📎 ${name}\n${body.fileUrl}`
    msg = buildTextMessage(composed, body.quickReplies)
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

  // Persist locally — bot/operator-side files are stored with their URL
  // so the conversation view can offer the download link back to the
  // operator too (e.g. for a paper trail of what was sent).
  const stored = recordMessage({
    userId,
    direction: 'operator',
    type: body.type,
    text: body.type === 'text' ? body.text : (body.type === 'file' ? body.text : undefined),
    payload: body.type === 'image'
      ? { imageUrl: body.imageUrl, previewImageUrl: body.previewImageUrl, quickReplies: body.quickReplies }
      : body.type === 'file'
        ? { fileUrl: body.fileUrl, fileName: body.fileName, quickReplies: body.quickReplies }
        : body.type === 'sticker'
          ? { packageId: body.packageId, stickerId: body.stickerId }
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
