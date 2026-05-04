import { NextResponse } from 'next/server'
import { setMode, type WikiMode } from '@/lib/customer-service/wiki-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const mode = body?.mode as WikiMode | undefined
  if (mode !== 'isolated' && mode !== 'bridge') {
    return NextResponse.json({ error: 'mode must be isolated or bridge' }, { status: 400 })
  }
  try {
    const { output } = await setMode(mode)
    return NextResponse.json({ ok: true, output })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
