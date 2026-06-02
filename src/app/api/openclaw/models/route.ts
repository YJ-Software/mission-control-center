import { NextRequest, NextResponse } from 'next/server'
import { getStatus, listAvailable } from '@/lib/openclaw/models-config'
import { listAgents } from '@/lib/openclaw/auth-profiles'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const agent = url.searchParams.get('agent')
  if (!agent || !SAFE_ID.test(agent)) {
    return NextResponse.json({ error: 'invalid agent' }, { status: 400 })
  }
  const known = (await listAgents()).map((a) => a.id)
  if (!known.includes(agent)) {
    return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 400 })
  }
  try {
    const [status, available] = await Promise.all([getStatus(agent), listAvailable(agent)])
    return NextResponse.json({ status, available })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
