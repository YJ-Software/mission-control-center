import { NextRequest, NextResponse } from 'next/server'
import { initDb } from '@/lib/db'
import { verifyBackupToken } from '@/lib/backup/helpers'
import { isBackupOrRestoreBusy } from '@/lib/backup/scripts'
import type { TriggerSource } from '@/lib/jobs/types'
import { startBackupRun, BackupJobNotFoundError, BackupBusyError } from '@/lib/backup/run-backup'

initDb()

const TRIGGER_SOURCES: TriggerSource[] = ['header-button', 'settings-card', 'quick-action', 'cron', 'api']

export async function POST(req: NextRequest) {
  if (!verifyBackupToken(req)) {
    return NextResponse.json({ error: 'Invalid backup token' }, { status: 401 })
  }

  if (isBackupOrRestoreBusy()) {
    return NextResponse.json({ error: 'A backup is already running' }, { status: 409 })
  }

  const body = await req.json()
  const { jobId, destinationId, sourceIds } = body
  const triggeredBy: TriggerSource = TRIGGER_SOURCES.includes(body.triggeredBy) ? body.triggeredBy : 'api'

  try {
    const { logId, jobMetaId } = startBackupRun({
      jobId,
      destinationId,
      sourceIds,
      triggeredBy,
    })
    return NextResponse.json({ ok: true, logId, jobId: jobMetaId })
  } catch (err) {
    if (err instanceof BackupJobNotFoundError) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (err instanceof BackupBusyError) return NextResponse.json({ error: 'A backup is already running' }, { status: 409 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
