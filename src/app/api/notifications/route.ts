import { NextRequest, NextResponse } from 'next/server'
import { listNotifications, markAllRead, clearAll, unreadCount } from '@/lib/notifications'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === '1'
  const items = listNotifications({ unreadOnly })
  return NextResponse.json({ items, unreadCount: unreadCount() })
}

export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action')
  if (action === 'read-all') {
    markAllRead()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

export async function DELETE() {
  clearAll()
  return NextResponse.json({ ok: true })
}
