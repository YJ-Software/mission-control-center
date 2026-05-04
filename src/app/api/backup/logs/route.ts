import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupLogs } from '@/lib/backup/schema'
import { eq, desc } from 'drizzle-orm'

initDb()

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const jobId = params.get('jobId')
  const logId = params.get('logId')
  const limit = parseInt(params.get('limit') || '50')
  const offset = parseInt(params.get('offset') || '0')

  if (logId) {
    const log = db.select().from(backupLogs).where(eq(backupLogs.id, parseInt(logId))).get()
    return NextResponse.json(log || null)
  }

  if (jobId) {
    const logs = db.select().from(backupLogs)
      .where(eq(backupLogs.jobId, jobId))
      .orderBy(desc(backupLogs.startedAt)).limit(limit).offset(offset).all()
    return NextResponse.json(logs)
  }

  const logs = db.select().from(backupLogs)
    .orderBy(desc(backupLogs.startedAt)).limit(limit).offset(offset).all()
  return NextResponse.json(logs)
}
