import { NextRequest, NextResponse } from 'next/server'
import { saveImage } from '@/lib/customer-service/cs-media'

export const runtime = 'nodejs'

/**
 * Operator uploads an image for the Conversations composer. We persist
 * locally and return both an id and a "public" URL the operator's send
 * action can hand to LINE's pushMessage (LINE will fetch from that URL
 * once on send and cache).
 *
 * Public URL is built from the request's host header; works as long as
 * the same hostname is reachable from LINE's servers (and not gated
 * behind CF Access for the /cs-media/<id> path).
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file field required' }, { status: 400 })

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const saved = saveImage(buf, file.type)
    const host = req.headers.get('host') ?? '127.0.0.1:3737'
    const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('127.0.0.1') ? 'http' : 'https')
    const url = `${proto}://${host}/api/customer-service/cs-media/${saved.id}`
    return NextResponse.json({
      ok: true,
      id: saved.id,
      url,
      mime: saved.mime,
      size: saved.size,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
