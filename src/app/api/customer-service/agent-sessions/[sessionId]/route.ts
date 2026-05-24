import { NextRequest, NextResponse } from 'next/server'
import { getAgentSessionTimeline } from '@/lib/customer-service/agent-sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const userId = req.nextUrl.searchParams.get('userId')
  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!userId || !agentId) {
    return NextResponse.json({ error: 'userId and agentId required' }, { status: 400 })
  }
  const timeline = getAgentSessionTimeline(agentId, sessionId, userId)
  if (!timeline) return NextResponse.json({ error: 'session jsonl not found' }, { status: 404 })
  return NextResponse.json(timeline)
}
