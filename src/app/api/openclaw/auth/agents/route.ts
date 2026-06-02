import { NextResponse } from 'next/server'
import { listAgents, readProfiles, readState, summarizeProfiles } from '@/lib/openclaw/auth-profiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  const agents = await listAgents()
  const enriched = []
  for (const a of agents) {
    const profiles = await readProfiles(a.id)
    const state = await readState(a.id)
    enriched.push({
      id: a.id,
      profiles: summarizeProfiles(profiles, state),
    })
  }
  return NextResponse.json({ agents: enriched })
}
