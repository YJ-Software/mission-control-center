import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { contacts } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { generateId } from '@/lib/utils'

initDb()

export async function GET() {
  const all = await db.select().from(contacts).orderBy(desc(contacts.createdAt))
  return NextResponse.json(all)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const contact = {
    id: generateId(),
    name: body.name,
    role: body.role || null,
    handle: body.handle || null,
    timezone: body.timezone || null,
    compensation: body.compensation || null,
    notes: body.notes || null,
    category: body.category || 'external',
  }
  await db.insert(contacts).values(contact)
  return NextResponse.json(contact, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.update(contacts).set({ ...updates, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(contacts.id, id))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.delete(contacts).where(eq(contacts.id, id))
  return NextResponse.json({ ok: true })
}
