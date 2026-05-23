import { NextResponse } from 'next/server'
import { getCsStats, getRecommendations } from '@/lib/customer-service/cs-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const stats = getCsStats()
  const recommendations = getRecommendations(stats)
  return NextResponse.json({ stats, recommendations })
}
