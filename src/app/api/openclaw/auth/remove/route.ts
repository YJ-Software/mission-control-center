import { NextRequest, NextResponse } from 'next/server'
import { listAgents, removeProfile } from '@/lib/openclaw/auth-profiles'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/
const SAFE_PROFILE_ID = /^[a-zA-Z0-9_.:@-]+$/

export async function POST(req: NextRequest) {
  let body: { agent?: string; profileId?: string; agents?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { profileId, agents, agent } = body
  if (!profileId || typeof profileId !== 'string' || !SAFE_PROFILE_ID.test(profileId)) {
    return NextResponse.json({ error: 'invalid profileId' }, { status: 400 })
  }
  const targets = agents && agents.length > 0 ? agents : agent ? [agent] : []
  if (targets.length === 0) {
    return NextResponse.json({ error: 'agent or agents required' }, { status: 400 })
  }
  // Agent ids hit the filesystem (~/.openclaw/agents/<id>/agent/auth-profiles.json) —
  // validate against the known set to defang path traversal.
  const knownAgents = (await listAgents()).map((a) => a.id)
  for (const a of targets) {
    if (typeof a !== 'string' || !SAFE_ID.test(a) || !knownAgents.includes(a)) {
      return NextResponse.json({ error: `invalid agent: ${a}` }, { status: 400 })
    }
  }
  for (const a of targets) {
    await removeProfile(a, profileId)
  }
  return NextResponse.json({ removed: { profileId, agents: targets } })
}
