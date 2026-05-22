import { NextRequest, NextResponse } from 'next/server'
import { listConversations, maybeRefreshProfile } from '@/lib/customer-service/cs-store'
import { isPaused, getPause } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const search = url.searchParams.get('q') || undefined
  const limit = Number(url.searchParams.get('limit') || '100') || 100
  const conversations = listConversations({ search, limit })

  // Hydrate missing profiles in the background; don't block the response.
  for (const c of conversations) {
    if (!c.displayName) {
      void maybeRefreshProfile(c.userId).catch(() => {})
    }
  }

  // Attach pause state for each
  const withPause = conversations.map(c => ({
    ...c,
    paused: isPaused(c.userId),
    pauseInfo: getPause(c.userId),
  }))
  return NextResponse.json({ conversations: withPause })
}
