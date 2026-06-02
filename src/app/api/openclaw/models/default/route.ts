import { NextRequest, NextResponse } from 'next/server'
import { setDefault } from '@/lib/openclaw/models-config'
import { listAgents } from '@/lib/openclaw/auth-profiles'

const SAFE_ID = /^[a-zA-Z0-9_.-]+$/

export async function POST(req: NextRequest) {
  let body: { agent?: string; model?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { agent, model } = body
  if (!agent || !SAFE_ID.test(agent)) {
    return NextResponse.json({ error: 'invalid agent' }, { status: 400 })
  }
  if (!model) return NextResponse.json({ error: 'model required' }, { status: 400 })
  const known = (await listAgents()).map((a) => a.id)
  if (!known.includes(agent)) {
    return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 400 })
  }
  try {
    await setDefault(agent, model)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
