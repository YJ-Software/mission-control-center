import { NextRequest, NextResponse } from 'next/server'
import { listAgentSessionsForUser } from '@/lib/customer-service/agent-sessions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const sessions = listAgentSessionsForUser(userId)
  return NextResponse.json({ sessions })
}
