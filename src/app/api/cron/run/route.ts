import { NextRequest, NextResponse } from 'next/server'
import { cronRun } from '@/lib/morning-report/cron-cli'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, mode } = body

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    const output = await cronRun(id, mode ?? 'force')
    return NextResponse.json({ ok: true, output })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
