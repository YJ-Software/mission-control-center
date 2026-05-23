import { NextRequest, NextResponse } from 'next/server'
import { recordMessage, maybeRefreshProfile, type Direction, type MessageType } from '@/lib/customer-service/cs-store'
import { fetchMessageContent } from '@/lib/customer-service/line-api'
import { saveImage, CS_MEDIA_DIR } from '@/lib/customer-service/cs-media'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

interface CsEventBody {
  userId: string
  direction: Direction
  type?: MessageType
  text?: string | null
  payload?: unknown
  lineMessageId?: string | null
  operatorId?: string | null
  channelId?: string | null
  rawEvent?: Record<string, unknown> | null
}

const MEDIA_EXT: Record<string, string> = {
  'image': 'jpg',
  'video': 'mp4',
  'audio': 'm4a',
  'file':  'bin',
}

/** Fetch binary content from LINE for this messageId and persist locally
 *  so the operator UI can render the image / play the audio without needing
 *  channel-auth access. Returns the stored filename for the cs_message
 *  payload, or null if the fetch fails (we still record the message stub
 *  so the conversation history doesn't have a gap).
 */
async function downloadLineMedia(messageId: string, type: string): Promise<{ filename: string; mime: string } | null> {
  try {
    const r = await fetchMessageContent(messageId)
    // For image types we can use the strict saveImage validator. Other
    // types (video / audio / file) we save raw with a discriminated ext.
    if (type === 'image') {
      const saved = saveImage(r.buffer, r.contentType)
      return { filename: saved.filename, mime: saved.mime }
    }
    const ext = inferExt(type, r.contentType)
    const filename = `${randomUUID()}.${ext}`
    writeFileSync(join(CS_MEDIA_DIR, filename), r.buffer)
    return { filename, mime: r.contentType }
  } catch (err) {
    console.warn(`[cs-event] download media ${messageId} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

function inferExt(type: string, mime: string): string {
  // Prefer the mime's extension hint when available, otherwise the
  // best-guess for the LINE message type.
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('audio')) return mime.includes('aac') ? 'aac' : 'm4a'
  if (mime.includes('pdf')) return 'pdf'
  return MEDIA_EXT[type] ?? 'bin'
}

// Note: we intentionally store only the storedFilename in the message
// payload (not a full URL). The plugin POSTs cs-event from localhost so
// the Host header is "127.0.0.1:3737" — baking that into the payload
// breaks rendering in the operator's browser (which sees the public
// hostname via CF Tunnel). The frontend reconstructs the URL relative
// to window.location at render time.

/**
 * Posted by the business-hours-gate plugin (and other future producers) to
 * record a LINE event into the conversations log. Fire-and-forget from the
 * plugin's side so we never block agent dispatch on slow processing here.
 *
 * For non-text inbound types (image/video/audio/file), this fetches the
 * binary from LINE's Content API and saves it under cs-uploads so the
 * conversation view can render thumbnails / download links.
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

  const t = (body.type ?? 'text') as MessageType
  let payload: Record<string, unknown> | undefined = body.payload && typeof body.payload === 'object'
    ? body.payload as Record<string, unknown>
    : undefined
  let text = body.text ?? null

  // Rich inbound: fetch the media so it's locally cached and embeddable.
  if (body.direction === 'user' && body.lineMessageId && (t === 'image' || t === 'video' || t === 'audio' || t === 'file')) {
    const saved = await downloadLineMedia(body.lineMessageId, t)
    if (saved) {
      payload = {
        ...(payload ?? {}),
        storedFilename: saved.filename,
        mime: saved.mime,
      }
    } else {
      // record the stub anyway so the operator sees "client sent an image"
      payload = { ...(payload ?? {}), fetchFailed: true }
      if (!text) text = `[${t} — 下載失敗]`
    }
  }

  // Sticker: extract package/sticker id from rawEvent if available, store
  // as payload — no binary fetch (LINE doesn't expose sticker assets via
  // the content endpoint).
  if (body.direction === 'user' && t === 'sticker' && body.rawEvent) {
    const raw = body.rawEvent as Record<string, unknown>
    payload = {
      ...(payload ?? {}),
      packageId: raw.packageId ?? raw.stickerPackageId,
      stickerId: raw.stickerId,
    }
  }

  const stored = recordMessage({
    userId: body.userId,
    direction: body.direction,
    type: t,
    text: text ?? undefined,
    payload,
    lineMessageId: body.lineMessageId ?? undefined,
    operatorId: body.operatorId ?? undefined,
  })

  void maybeRefreshProfile(body.userId).catch(() => {})

  return NextResponse.json({ ok: true, id: stored.id })
}
