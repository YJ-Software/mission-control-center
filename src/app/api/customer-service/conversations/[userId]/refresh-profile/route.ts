import { NextRequest, NextResponse } from 'next/server'
import { maybeRefreshProfile, getConversation } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  try {
    await maybeRefreshProfile(userId, true)
    return NextResponse.json({ ok: true, conversation: getConversation(userId) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
