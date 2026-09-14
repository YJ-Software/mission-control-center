import { NextResponse } from 'next/server'
import {
  listAgents,
  listStoredProfiles,
  readProfiles,
  readState,
  summarizeProfiles,
  withStoreOnlyProfiles,
} from '@/lib/openclaw/auth-profiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  const agents = await listAgents()
  const enriched = await Promise.all(
    agents.map(async (a) => {
      const [profiles, state, stored] = await Promise.all([
        readProfiles(a.id),
        readState(a.id),
        listStoredProfiles(a.id),
      ])
      return { id: a.id, profiles: withStoreOnlyProfiles(summarizeProfiles(profiles, state), stored) }
    }),
  )
  return NextResponse.json({ agents: enriched })
}
