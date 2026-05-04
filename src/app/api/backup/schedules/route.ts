import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupSchedules, backupJobs } from '@/lib/backup/schema'
import { eq, sql } from 'drizzle-orm'
import { newId, validateScheduleConfig } from '@/lib/backup/helpers'
import { syncBackupCron } from '@/lib/backup/sync-cron'

initDb()

export async function GET() {
  const items = db.select().from(backupSchedules).all()
  const result = items.map(s => {
    const count = db.select({ count: sql<number>`count(*)` })
      .from(backupJobs).where(eq(backupJobs.scheduleId, s.id)).get()
    return { ...s, jobsAssigned: count?.count ?? 0 }
  })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { name, type, config } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'Missing name or type' }, { status: 400 })

  const parsed = typeof config === 'string' ? JSON.parse(config) : config
  const validationError = validateScheduleConfig(type, parsed)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const id = newId()
  db.insert(backupSchedules).values({ id, name, type, config: JSON.stringify(parsed) }).run()
  return NextResponse.json({ ok: true, id })
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (updates.type && updates.config) {
    const parsed = typeof updates.config === 'string' ? JSON.parse(updates.config) : updates.config
    const err = validateScheduleConfig(updates.type, parsed)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    updates.config = JSON.stringify(parsed)
  }

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (updates.name !== undefined) set.name = updates.name
  if (updates.type !== undefined) set.type = updates.type
  if (updates.config !== undefined) set.config = updates.config

  db.update(backupSchedules).set(set).where(eq(backupSchedules.id, id)).run()
  syncBackupCron().catch(console.error)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const refs = db.select().from(backupJobs).where(eq(backupJobs.scheduleId, id)).all()
  if (refs.length > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${refs.length} job(s) reference this schedule`,
      jobs: refs.map(j => j.name),
    }, { status: 409 })
  }

  db.delete(backupSchedules).where(eq(backupSchedules.id, id)).run()
  syncBackupCron().catch(console.error)
  return NextResponse.json({ ok: true })
}
