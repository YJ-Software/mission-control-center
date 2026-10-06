import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import { verifyBackupToken, getAllBackupDirs } from '@/lib/backup/helpers'
import { isBackupOrRestoreBusy } from '@/lib/backup/scripts'
import { resolveInsideDirs } from '@/lib/backup/path-guard'
import { describeBackup, startRestore, BackupBusyError, RestoreRejectedError } from '@/lib/backup/run-restore'
import type { TriggerSource } from '@/lib/jobs/types'
import { initDb } from '@/lib/db'

initDb()

const TRIGGER_SOURCES: TriggerSource[] = ['header-button', 'settings-card', 'quick-action', 'cron', 'api']

export async function POST(req: NextRequest) {
  if (!verifyBackupToken(req)) {
    return NextResponse.json({ error: 'Invalid backup token' }, { status: 401 })
  }

  let body: { file?: unknown; dryRun?: unknown; triggeredBy?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.file !== 'string' || !body.file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  let file: string
  try {
    file = resolveInsideDirs(body.file, getAllBackupDirs())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  if (!fs.existsSync(file)) return NextResponse.json({ error: 'Backup file not found' }, { status: 400 })

  try {
    if (body.dryRun) {
      const d = await describeBackup(file)
      if (d.kind === 'legacy-openclaw' && !d.legacyRestorable) {
        return NextResponse.json({ error: d.summary, kind: d.kind }, { status: 400 })
      }
      return NextResponse.json({ ok: true, output: d.summary, kind: d.kind })
    }
    if (isBackupOrRestoreBusy()) {
      return NextResponse.json({ error: 'A backup or restore is already running' }, { status: 409 })
    }
    const triggeredBy: TriggerSource = TRIGGER_SOURCES.includes(body.triggeredBy as TriggerSource)
      ? (body.triggeredBy as TriggerSource) : 'api'
    const meta = startRestore(file, triggeredBy)
    return NextResponse.json({ ok: true, jobId: meta.id })
  } catch (err) {
    if (err instanceof BackupBusyError) return NextResponse.json({ error: err.message }, { status: 409 })
    if (err instanceof RestoreRejectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
