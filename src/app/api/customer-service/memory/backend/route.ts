import { NextResponse } from 'next/server'
import { getStatus, setMode } from '@/lib/customer-service/memory-backend'

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
    body = {}
  }
  if (body?.mode !== undefined && body.mode !== 'mem0') {
    return NextResponse.json({ error: 'only mem0 mode is supported' }, { status: 400 })
  }
  try {
    const { output, agentId } = await setMode()
    return NextResponse.json({ ok: true, agentId, output })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
