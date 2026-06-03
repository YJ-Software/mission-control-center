import { NextResponse } from 'next/server'
import { getAgentsList, getGlobalDefaults } from '@/lib/openclaw/models-config'
import { listAgents } from '@/lib/openclaw/auth-profiles'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Two sources need merging: agents on disk (~/.openclaw/agents/*) and
    // agents.list[] in openclaw.json. On a fresh install only the on-disk
    // agents exist; openclaw.json carries overrides once anyone configures
    // models. Show all on-disk agents, attach overrides where present.
    const [fsAgents, configList, defaults] = await Promise.all([
      listAgents(),
      getAgentsList(),
      getGlobalDefaults(),
    ])
    const overrideById = new Map(configList.map((e) => [e.id, e.model]))
    const merged = fsAgents.map((a) => ({ id: a.id, model: overrideById.get(a.id) }))
    // Surface any agents.list entries that don't have a matching dir too —
    // unlikely in practice but lossless for diagnosability.
    for (const e of configList) {
      if (!merged.find((m) => m.id === e.id)) {
        merged.push({ id: e.id, model: e.model })
      }
    }
    return NextResponse.json({
      agents: merged,
      defaults,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
