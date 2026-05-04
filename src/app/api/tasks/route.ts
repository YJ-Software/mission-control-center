import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { tasks } from '@/lib/schema'
import { eq, desc, count } from 'drizzle-orm'
import { generateId } from '@/lib/utils'

initDb()

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const summary = searchParams.get('summary')

  if (summary) {
    const allTasks = await db.select().from(tasks)
    const inProgress = allTasks.filter(t => t.status === 'in-progress').length
    const total = allTasks.length
    return NextResponse.json({ inProgress, total, contentPipeline: 0 })
  }

  const allTasks = await db.select().from(tasks).orderBy(desc(tasks.createdAt))
  return NextResponse.json(allTasks)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const task = {
    id: generateId(),
    title: body.title,
    description: body.description || null,
    status: body.status || 'todo',
    priority: body.priority || 'medium',
    assignee: body.assignee || null,
    project: body.project || null,
    dueDate: body.dueDate || null,
  }
  await db.insert(tasks).values(task)
  return NextResponse.json(task, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.update(tasks).set({ ...updates, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(tasks.id, id))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.delete(tasks).where(eq(tasks.id, id))
  return NextResponse.json({ ok: true })
}
