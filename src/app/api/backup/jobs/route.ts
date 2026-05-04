import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupJobs, backupDestinations, backupSchedules, backupLogs } from '@/lib/backup/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { newId } from '@/lib/backup/helpers'
import { syncBackupCron } from '@/lib/backup/sync-cron'

initDb()

export async function GET() {
  const jobs = db.select().from(backupJobs).all()
  const result = jobs.map(job => {
    const dest = db.select().from(backupDestinations).where(eq(backupDestinations.id, job.destinationId)).get()
    const sched = db.select().from(backupSchedules).where(eq(backupSchedules.id, job.scheduleId)).get()
    const lastLog = db.select().from(backupLogs)
      .where(eq(backupLogs.jobId, job.id))
      .orderBy(desc(backupLogs.startedAt))
      .limit(1).get()
    return {
      ...job,
      destinationName: dest?.name ?? 'Unknown',
      scheduleName: sched?.name ?? 'Unknown',
      scheduleType: sched?.type,
      lastRun: lastLog?.startedAt,
      lastStatus: lastLog?.status,
    }
  })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { name, destinationId, scheduleId, retainCount, sourceIds, includeOpenClaw, model } = await req.json()
  if (!name || !destinationId || !scheduleId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const id = newId()
  db.insert(backupJobs).values({
    id, name, destinationId, scheduleId,
    retainCount: retainCount || 7,
    sourceIds: JSON.stringify(sourceIds || []),
    includeOpenClaw: includeOpenClaw === false ? 0 : 1,
    model: model || null,
  }).run()

  syncBackupCron().catch(console.error)
  return NextResponse.json({ ok: true, id })
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (updates.name !== undefined) set.name = updates.name
  if (updates.destinationId !== undefined) set.destinationId = updates.destinationId
  if (updates.scheduleId !== undefined) set.scheduleId = updates.scheduleId
  if (updates.retainCount !== undefined) set.retainCount = updates.retainCount
  if (updates.sourceIds !== undefined) set.sourceIds = JSON.stringify(updates.sourceIds)
  if (updates.includeOpenClaw !== undefined) set.includeOpenClaw = updates.includeOpenClaw ? 1 : 0
  if (updates.enabled !== undefined) set.enabled = updates.enabled
  if (updates.model !== undefined) set.model = updates.model

  db.update(backupJobs).set(set).where(eq(backupJobs.id, id)).run()
  syncBackupCron().catch(console.error)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  db.delete(backupJobs).where(eq(backupJobs.id, id)).run()
  syncBackupCron().catch(console.error)
  return NextResponse.json({ ok: true })
}
