import { NextRequest, NextResponse } from 'next/server'
import { listMessages, getConversation, maybeRefreshProfile } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Hydrate profile if needed (fire-and-forget; rendering can fall back to userId)
  void maybeRefreshProfile(userId).catch(() => {})

  const conversation = getConversation(userId)
  const messages = listMessages(userId, { limit: 200 })
  return NextResponse.json({ conversation, messages })
}
