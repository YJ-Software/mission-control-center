import { NextRequest, NextResponse } from 'next/server'
import { cronRuns } from '@/lib/morning-report/cron-cli'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const limit = Number(searchParams.get('limit') ?? 20)

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    const entries = await cronRuns(id, limit)
    return NextResponse.json({ entries })
  } catch (err) {
    return NextResponse.json({ entries: [], error: String(err) })
  }
}
