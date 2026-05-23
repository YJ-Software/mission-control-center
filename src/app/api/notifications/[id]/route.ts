import { NextRequest, NextResponse } from 'next/server'
import { markRead, deleteNotification } from '@/lib/notifications'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const action = new URL(req.url).searchParams.get('action')
  if (action === 'read') {
    markRead(id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteNotification(id)
  return NextResponse.json({ ok: true })
}
