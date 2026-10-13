import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupDestinations, backupJobs } from '@/lib/backup/schema'
import { eq } from 'drizzle-orm'
import { newId } from '@/lib/backup/helpers'
import { toPublicDestination, mergeDestinationConfig, PasswordRequiredError } from '@/lib/backup/secrets'

initDb()

export async function GET() {
  // 密碼不回傳到瀏覽器：換成遮罩值並附 hasPassword
  const items = db.select().from(backupDestinations).all()
  return NextResponse.json(items.map(toPublicDestination))
}

export async function POST(req: NextRequest) {
  const { name, type, config } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'Missing name or type' }, { status: 400 })
  if (!['ftp', 'local'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const id = newId()
  db.insert(backupDestinations).values({
    id, name, type, config: JSON.stringify(mergeDestinationConfig(undefined, config || {}, type)),
  }).run()

  return NextResponse.json({ ok: true, id })
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (updates.name !== undefined) set.name = updates.name
  if (updates.type !== undefined) set.type = updates.type
  if (updates.config !== undefined) {
    // 空密碼或遮罩值代表「不變更」：沿用 DB 裡的既有密碼
    const existing = db.select().from(backupDestinations).where(eq(backupDestinations.id, id)).get()
    const type = updates.type ?? existing?.type
    try {
      set.config = JSON.stringify(mergeDestinationConfig(existing?.config, updates.config || {}, type))
    } catch (err) {
      if (err instanceof PasswordRequiredError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }
  }
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
