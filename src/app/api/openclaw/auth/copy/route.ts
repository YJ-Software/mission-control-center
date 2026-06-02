import { NextRequest, NextResponse } from 'next/server'
import { copyProfile, listAgents } from '@/lib/openclaw/auth-profiles'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/
const SAFE_PROFILE_ID = /^[a-zA-Z0-9_.:@-]+$/

export async function POST(req: NextRequest) {
  let body: { profileId?: string; fromAgent?: string; toAgents?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { profileId, fromAgent, toAgents } = body
  if (!profileId || !fromAgent || !Array.isArray(toAgents) || toAgents.length === 0) {
    return NextResponse.json(
      { error: 'profileId, fromAgent, toAgents[] required' },
      { status: 400 },
    )
  }
  if (typeof profileId !== 'string' || !SAFE_PROFILE_ID.test(profileId)) {
    return NextResponse.json({ error: 'invalid profileId' }, { status: 400 })
  }
  const knownAgents = (await listAgents()).map((a) => a.id)
  if (!SAFE_ID.test(fromAgent) || !knownAgents.includes(fromAgent)) {
    return NextResponse.json({ error: `invalid fromAgent: ${fromAgent}` }, { status: 400 })
  }
  for (const a of toAgents) {
    if (typeof a !== 'string' || !SAFE_ID.test(a) || !knownAgents.includes(a)) {
      return NextResponse.json({ error: `invalid toAgents entry: ${a}` }, { status: 400 })
    }
  }
  await copyProfile(profileId, fromAgent, toAgents)
  return NextResponse.json({ copied: { profileId, fromAgent, toAgents } })
}
