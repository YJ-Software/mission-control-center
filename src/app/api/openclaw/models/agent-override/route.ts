import { NextRequest, NextResponse } from 'next/server'
import {
  clearAgentModelOverride,
  getAgentsList,
  setAgentModelOverride,
  type AgentModelOverride,
} from '@/lib/openclaw/models-config'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/

export async function POST(req: NextRequest) {
  let body: {
    agent?: string
    action?: 'set' | 'clear'
    primary?: string | null
    fallbacks?: string[] | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { agent, action } = body
  if (!agent || !SAFE_ID.test(agent)) {
    return NextResponse.json({ error: 'invalid agent' }, { status: 400 })
  }
  const known = (await getAgentsList()).map((a) => a.id)
  if (!known.includes(agent)) {
    return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 400 })
  }
  try {
    if (action === 'clear') {
      await clearAgentModelOverride(agent)
    } else if (action === 'set') {
      const override: AgentModelOverride = {}
      if (body.primary != null) override.primary = body.primary
      if (body.fallbacks != null) override.fallbacks = body.fallbacks
      if (Object.keys(override).length === 0) {
        return NextResponse.json(
          { error: 'set requires primary and/or fallbacks' },
          { status: 400 },
        )
      }
      await setAgentModelOverride(agent, override)
    } else {
      return NextResponse.json({ error: 'invalid action' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
