import { NextResponse } from 'next/server'
import { getStatus, setMode, type MemoryBackend } from '@/lib/customer-service/memory-backend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(getStatus())
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const mode = body?.mode as MemoryBackend | undefined
  if (mode !== 'mem0' && mode !== 'wiki-person') {
    return NextResponse.json({ error: 'mode must be mem0 or wiki-person' }, { status: 400 })
  }
  try {
    const { output, agentId } = await setMode(mode)
    return NextResponse.json({ ok: true, agentId, output })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
