import { NextRequest, NextResponse } from 'next/server'
import {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
} from '@/lib/customer-service/wiki-entries'

function errorResponse(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : String(err)
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const filename = searchParams.get('filename')
  try {
    if (filename) return NextResponse.json(await getEntry(filename))
    return NextResponse.json({ entries: await listEntries() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { title?: string; content?: string }
    if (typeof body.title !== 'string' || typeof body.content !== 'string') {
      return errorResponse(new Error('title and content are required'), 400)
    }
    return NextResponse.json(await createEntry(body.title, body.content))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      filename?: string
      title?: string
      content?: string
      status?: string
    }
    if (typeof body.filename !== 'string') {
      return errorResponse(new Error('filename is required'), 400)
    }
    return NextResponse.json(
      await updateEntry(body.filename, {
        title: body.title,
        content: body.content,
        status: body.status,
      }),
    )
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const filename = searchParams.get('filename')
  if (!filename) return errorResponse(new Error('filename query param required'), 400)
  try {
    await deleteEntry(filename)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
