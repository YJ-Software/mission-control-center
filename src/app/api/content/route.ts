import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { contentItems } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { generateId } from '@/lib/utils'

initDb()

export async function GET() {
  const all = await db.select().from(contentItems).orderBy(desc(contentItems.updatedAt))
  return NextResponse.json(all)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const item = {
    id: generateId(),
    title: body.title,
    platform: body.platform || null,
    stage: body.stage || 'idea',
    script: body.script || null,
    notes: body.notes || null,
    scheduledDate: body.scheduledDate || null,
    status: body.status || 'draft',
    externalLink: body.externalLink || null,
  }
  await db.insert(contentItems).values(item)
  return NextResponse.json(item, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.update(contentItems).set({ ...updates, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(contentItems.id, id))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.delete(contentItems).where(eq(contentItems.id, id))
  return NextResponse.json({ ok: true })
}
