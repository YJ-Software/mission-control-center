import { NextRequest, NextResponse } from 'next/server'
import { readAllJobs } from '@/lib/jobs/store'
import { runOrphanRecoveryOnce } from '@/lib/jobs/recovery'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  runOrphanRecoveryOnce()
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const status = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000)

  const all = await readAllJobs()
  const filtered = all.filter((j) => {
    if (kind && j.kind !== kind) return false
    if (status && j.status !== status) return false
    return true
  })
  return NextResponse.json({ jobs: filtered.slice(0, limit) })
}
