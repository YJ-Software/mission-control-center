import { NextRequest, NextResponse } from 'next/server'
import { saveImage, saveFile } from '@/lib/customer-service/cs-media'

export const runtime = 'nodejs'

/**
 * Operator uploads media for the Conversations composer.
 *
 * - Images go through saveImage (strict mime check; UI sends as LINE
 *   image message via originalContentUrl).
 * - Other files (PDF, docx, audio, video) go through saveFile and the
 *   operator's send action wraps the URL in a text message — LINE has
 *   no native generic-file message type.
 *
 * Returns { id, url, mime, size, kind }.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file field required' }, { status: 400 })

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const isImage = file.type.startsWith('image/')
    const saved = isImage
      ? saveImage(buf, file.type)
      : saveFile(buf, file.type, file.name)
    const host = req.headers.get('host') ?? '127.0.0.1:3737'
    const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('127.0.0.1') ? 'http' : 'https')
    const url = `${proto}://${host}/api/customer-service/cs-media/${saved.id}`
    return NextResponse.json({
      ok: true,
      kind: isImage ? 'image' : 'file',
      id: saved.id,
      url,
      mime: saved.mime,
      size: saved.size,
      originalName: isImage ? undefined : file.name,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
