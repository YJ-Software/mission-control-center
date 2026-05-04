import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupDestinations, backupJobs } from '@/lib/backup/schema'
import { eq } from 'drizzle-orm'
import { newId } from '@/lib/backup/helpers'

initDb()

export async function GET() {
  const items = db.select().from(backupDestinations).all()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const { name, type, config } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'Missing name or type' }, { status: 400 })
  if (!['ftp', 'local'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const id = newId()
  db.insert(backupDestinations).values({
    id, name, type, config: JSON.stringify(config || {}),
  }).run()

  return NextResponse.json({ ok: true, id })
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (updates.name !== undefined) set.name = updates.name
  if (updates.type !== undefined) set.type = updates.type
  if (updates.config !== undefined) set.config = JSON.stringify(updates.config)
  if (updates.enabled !== undefined) set.enabled = updates.enabled

  db.update(backupDestinations).set(set).where(eq(backupDestinations.id, id)).run()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const refs = db.select().from(backupJobs).where(eq(backupJobs.destinationId, id)).all()
  if (refs.length > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${refs.length} job(s) reference this destination`,
      jobs: refs.map(j => j.name),
    }, { status: 409 })
  }

  db.delete(backupDestinations).where(eq(backupDestinations.id, id)).run()
  return NextResponse.json({ ok: true })
}
