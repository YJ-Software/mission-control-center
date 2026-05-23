import { NextRequest, NextResponse } from 'next/server'
import { readImage } from '@/lib/customer-service/cs-media'

export const runtime = 'nodejs'

/**
 * Serve a stored cs-media file. No auth required by design — LINE's
 * servers fetch this URL (anonymously, from LINE's IP range) when the
 * operator sends an image message. The id format validation in readImage
 * blocks path traversal.
 *
 * If the operator's MCC sits behind CF Access, the matching Access app
 * must allow /api/customer-service/cs-media/* (e.g. Bypass for everyone,
 * or Bypass for LINE's IP ranges).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const img = readImage(id)
  if (!img) return new NextResponse('not found', { status: 404 })
  return new NextResponse(img.buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': img.mime,
      'Content-Length': String(img.buffer.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
