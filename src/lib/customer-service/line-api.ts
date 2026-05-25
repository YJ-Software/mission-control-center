import { readLineCredentials } from './line-credentials'

const LINE_API = 'https://api.line.me/v2/bot'
const LINE_DATA = 'https://api-data.line.me/v2/bot'

class LineApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`LINE API ${status}: ${body.slice(0, 200)}`)
  }
}

function authHeaders(): Record<string, string> {
  const { channelAccessToken } = readLineCredentials()
  if (!channelAccessToken) throw new Error('LINE channel access token not configured — set in Settings → LINE Channel')
  return { Authorization: `Bearer ${channelAccessToken}` }
}

export interface LineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
  statusMessage?: string
  language?: string
}

export async function getProfile(userId: string): Promise<LineProfile | null> {
  const res = await fetch(`${LINE_API}/profile/${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 404) return null   // user removed the bot as friend
  if (!res.ok) throw new LineApiError(res.status, await res.text())
  return (await res.json()) as LineProfile
}

export interface LineMessage {
  type: 'text' | 'image' | 'sticker'
  text?: string
  originalContentUrl?: string
  previewImageUrl?: string
  packageId?: string
  stickerId?: string
  quickReply?: { items: Array<{ type: 'action'; action: { type: 'message'; label: string; text: string } }> }
}

export function buildTextMessage(text: string, quickReplyLabels?: string[]): LineMessage {
  const msg: LineMessage = { type: 'text', text }
  if (quickReplyLabels && quickReplyLabels.length > 0) {
    msg.quickReply = {
      items: quickReplyLabels.slice(0, 13).map(label => ({
        type: 'action',
        action: { type: 'message', label: label.slice(0, 20), text: label },
      })),
    }
  }
  return msg
}

export function buildImageMessage(originalContentUrl: string, previewImageUrl?: string): LineMessage {
  return {
    type: 'image',
    originalContentUrl,
    previewImageUrl: previewImageUrl || originalContentUrl,
  }
}

export function buildStickerMessage(packageId: string, stickerId: string): LineMessage {
  return { type: 'sticker', packageId, stickerId }
}

export async function pushMessage(userId: string, messages: LineMessage[]): Promise<{ sentMessages?: Array<{ id: string }> }> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: userId, messages }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new LineApiError(res.status, await res.text())
  return (await res.json()) as { sentMessages?: Array<{ id: string }> }
}

export async function getBotInfo(): Promise<{ userId: string; displayName: string; pictureUrl?: string; chatMode: string; markAsReadMode: string }> {
  const res = await fetch(`${LINE_API}/info`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new LineApiError(res.status, await res.text())
  return (await res.json()) as { userId: string; displayName: string; pictureUrl?: string; chatMode: string; markAsReadMode: string }
}

/**
 * Fetch a LINE message content (image/audio/video/file) sent by a user.
 * Returns the raw bytes plus content-type and (for file type) the
 * original filename. LINE includes the user's original filename in the
 * Content-Disposition response header — pull it out so MCC can offer
 * meaningful download names and display.
 */
export async function fetchMessageContent(messageId: string): Promise<{
  buffer: Buffer
  contentType: string
  filename: string | null
}> {
  const res = await fetch(`${LINE_DATA}/message/${encodeURIComponent(messageId)}/content`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new LineApiError(res.status, await res.text())
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const filename = parseFilenameFromDisposition(res.headers.get('content-disposition'))
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType, filename }
}

/** RFC 6266 attachment-filename extractor. Handles both
 *  `filename="x.pdf"` and the encoded `filename*=UTF-8''x.pdf` forms. */
function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*\s*=\s*([^']*)'([^']*)'([^;]+)/i)
  if (star) {
    try { return decodeURIComponent(star[3].trim()) } catch { /* fall through */ }
  }
  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i)
  if (quoted) return quoted[1]
  const bare = header.match(/filename\s*=\s*([^;]+)/i)
  if (bare) return bare[1].trim()
  return null
}
