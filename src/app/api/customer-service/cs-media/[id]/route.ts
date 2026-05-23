import { NextRequest, NextResponse } from 'next/server'
import { readImage } from '@/lib/customer-service/cs-media'
import { db } from '@/lib/db'
import { csMessages } from '@/lib/schema'
import { like } from 'drizzle-orm'

export const runtime = 'nodejs'

/**
 * Serve a stored cs-media file. No auth required by design — LINE's
 * servers fetch this URL (anonymously, from LINE's IP range) when the
 * operator sends an image message, and the operator's own browser hits
 * it for inline rendering. The id format validation in readImage blocks
 * path traversal.
 *
 * When ?download=1 is set OR the file is non-inline (PDF, docx, ...)
 * and we know the original sender filename, set Content-Disposition so
 * the browser uses that name instead of the random UUID we stored under.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const img = readImage(id)
  if (!img) return new NextResponse('not found', { status: 404 })

  const url = new URL(req.url)
  const forceDownload = url.searchParams.get('download') === '1'
  const originalName = lookupOriginalName(id)

  const headers: Record<string, string> = {
    'Content-Type': img.mime,
    'Content-Length': String(img.buffer.byteLength),
    'Cache-Control': 'public, max-age=31536000, immutable',
  }
  if (originalName) {
    const safe = sanitiseFilename(originalName)
    const disposition = forceDownload || !img.mime.startsWith('image/') ? 'attachment' : 'inline'
    // Provide both quoted ASCII fallback and RFC 5987 UTF-8 form so
    // browsers / curl on every platform pick something sensible.
    const asciiName = safe.replace(/[^\x20-\x7e]/g, '_')
    headers['Content-Disposition'] = `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safe)}`
  }

  return new NextResponse(img.buffer as unknown as BodyInit, { headers })
}

function sanitiseFilename(name: string): string {
  return name.replace(/[\/\\]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'download'
}

/** Best-effort: pull the original filename out of the most recent
 *  cs_messages row whose payload referenced this storedFilename. We
 *  don't have a foreign key here; the LIKE scan is cheap because the
 *  payload column is small. */
function lookupOriginalName(storedFilename: string): string | null {
  try {
    const rows = db.select().from(csMessages)
      .where(like(csMessages.payload, `%${storedFilename}%`))
      .all() as Array<{ payload: string | null }>
    for (const r of rows) {
      if (!r.payload) continue
      try {
        const p = JSON.parse(r.payload) as { storedFilename?: string; fileName?: string }
        if (p.storedFilename === storedFilename && typeof p.fileName === 'string') return p.fileName
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null
}
