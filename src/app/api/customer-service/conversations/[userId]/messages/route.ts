import { NextRequest, NextResponse } from 'next/server'
import { listMessages, getConversation, maybeRefreshProfile, isPaused, getPause } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Hydrate profile if needed (fire-and-forget; rendering can fall back to userId)
  void maybeRefreshProfile(userId).catch(() => {})

  // Include paused state so the conversation-view header's toggle reflects
  // the latest pause without waiting on the every-5s list refetch. Without
  // this, detail.conversation shadowed initial.conversation in the view and
  // the toggle appeared stuck.
  const conv = getConversation(userId)
  const conversation = conv ? { ...conv, paused: isPaused(userId), pauseInfo: getPause(userId) } : null
  const messages = listMessages(userId, { limit: 200 })
  return NextResponse.json({ conversation, messages })
}
