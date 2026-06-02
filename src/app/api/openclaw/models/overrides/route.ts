import { NextResponse } from 'next/server'
import { getAgentsList, getGlobalDefaults } from '@/lib/openclaw/models-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const list = await getAgentsList()
    // Use TRUE global defaults from agents.defaults.model — getStatus(agent)
    // returns the per-agent effective view (respects overrides), which made
    // the Global tab show whichever agent's resolved config.
    const defaults = await getGlobalDefaults()
    return NextResponse.json({
      agents: list,
      defaults,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
