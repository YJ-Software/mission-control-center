import { NextRequest, NextResponse } from 'next/server'
import { addAlias, removeAlias } from '@/lib/openclaw/models-config'
import { listAgents } from '@/lib/openclaw/auth-profiles'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/

export async function POST(req: NextRequest) {
  let body: { agent?: string; action?: 'add' | 'remove'; alias?: string; model?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { agent, action, alias, model } = body
  if (!agent || !SAFE_ID.test(agent)) {
    return NextResponse.json({ error: 'invalid agent' }, { status: 400 })
  }
  if (!alias) return NextResponse.json({ error: 'alias required' }, { status: 400 })
  const known = (await listAgents()).map((a) => a.id)
  if (!known.includes(agent)) {
    return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 400 })
  }
  try {
    if (action === 'add') {
      if (!model) return NextResponse.json({ error: 'model required' }, { status: 400 })
      await addAlias(agent, alias, model)
    } else if (action === 'remove') {
      await removeAlias(agent, alias)
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
