import { NextRequest, NextResponse } from 'next/server'
import { getJob, readJobLog } from '@/lib/jobs/store'
import { runOrphanRecoveryOnce } from '@/lib/jobs/recovery'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  runOrphanRecoveryOnce()
  const { id } = await params
  const meta = await getJob(id)
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const log = await readJobLog(id)
  return NextResponse.json({ meta, log })
}
