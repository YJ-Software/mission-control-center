import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupSources, backupJobs } from '@/lib/backup/schema'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { newId, expandHome } from '@/lib/backup/helpers'
import fs from 'fs'

initDb()

/** Auto-detect Obsidian vault path from second-brain settings and ensure a backup source exists */
function autoDetectSources() {
  const row = db.select().from(settings).where(eq(settings.key, 'obsidian.vault_path')).get()
  if (!row?.value) return

  const vaultPath = expandHome(row.value)
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) return

  // Check if a source with this path already exists
  const existing = db.select().from(backupSources).all()
  if (existing.some(s => expandHome(s.path) === vaultPath)) return

  // Auto-create
  db.insert(backupSources).values({
    id: newId(),
    name: 'Obsidian Vault',
    path: vaultPath,
    description: 'Auto-detected from Second Brain settings',
    enabled: 1,
  }).run()
}

export async function GET() {
  autoDetectSources()
  const items = db.select().from(backupSources).all()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const { name, path: dirPath, description } = await req.json()
  if (!name || !dirPath) return NextResponse.json({ error: 'Missing name or path' }, { status: 400 })
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return NextResponse.json({ error: 'Path does not exist or is not a directory' }, { status: 400 })
  }

  const id = newId()
  db.insert(backupSources).values({ id, name, path: dirPath, description }).run()
  return NextResponse.json({ ok: true, id })
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const set: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (updates.name !== undefined) set.name = updates.name
  if (updates.path !== undefined) set.path = updates.path
  if (updates.description !== undefined) set.description = updates.description
  if (updates.enabled !== undefined) set.enabled = updates.enabled

  db.update(backupSources).set(set).where(eq(backupSources.id, id)).run()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const allJobs = db.select().from(backupJobs).all()
  const refs = allJobs.filter(j => {
    const ids: string[] = JSON.parse(j.sourceIds || '[]')
    return ids.includes(id)
  })
  if (refs.length > 0) {
    return NextResponse.json({
      error: 'DELETE_BLOCKED',
      jobs: refs.map(j => j.name),
    }, { status: 409 })
  }

  db.delete(backupSources).where(eq(backupSources.id, id)).run()
  return NextResponse.json({ ok: true })
}
