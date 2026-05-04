import { NextResponse } from 'next/server'
import { getSystemStats, getHealthHistory } from '@/lib/system-stats'

export async function GET() {
  try {
    const stats = getSystemStats()
    const history = getHealthHistory()
    return NextResponse.json({ ...stats, history })
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    )
  }
}
