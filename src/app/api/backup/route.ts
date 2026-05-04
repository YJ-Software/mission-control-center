import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupJobs, backupLogs, backupDestinations } from '@/lib/backup/schema'
import { eq, sql } from 'drizzle-orm'
import { listBackupFiles, deleteBackupFile } from '@/lib/backup/scripts'
import { checkScriptsAvailable, getOrCreateBackupToken, formatBytes, getBackupOutputDir, expandHome } from '@/lib/backup/helpers'

initDb()

/** Collect all unique backup directories: default + all local destinations */
function getAllBackupDirs(): string[] {
  const dirs = new Set<string>()
  dirs.add(getBackupOutputDir())
  const dests = db.select().from(backupDestinations).all()
  for (const d of dests) {
    if (d.type === 'local') {
      try {
        const config = JSON.parse(d.config)
        if (config.path) dirs.add(expandHome(config.path))
      } catch { /* skip */ }
    }
  }
  return Array.from(dirs)
}

/** List backup files from all backup directories */
function listAllBackupFiles() {
  const dirs = getAllBackupDirs()
  const allFiles = dirs.flatMap(dir => listBackupFiles(dir))
  // Deduplicate by filePath and sort newest first
  const seen = new Set<string>()
  return allFiles.filter(f => {
    if (seen.has(f.filePath)) return false
    seen.add(f.filePath)
    return true
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function GET(req: NextRequest) {
  const type = new URL(req.url).searchParams.get('type')

  if (type === 'dashboard') {
    const scriptsCheck = checkScriptsAvailable()
    const totalJobs = db.select({ count: sql<number>`count(*)` }).from(backupJobs).get()
    const files = listAllBackupFiles()
    const totalUsageBytes = files.reduce((sum, f) => sum + f.size, 0)

    const statuses = ['pending', 'processing', 'completed', 'failed', 'canceled'] as const
    const queue: Record<string, number> = {}
    for (const s of statuses) {
      const row = db.select({ count: sql<number>`count(*)` }).from(backupLogs)
        .where(eq(backupLogs.status, s)).get()
      queue[s] = row?.count ?? 0
    }

    return NextResponse.json({
      totalBackups: files.length,
      totalUsage: formatBytes(totalUsageBytes),
      totalUsageBytes,
      totalJobs: totalJobs?.count ?? 0,
      queue,
      scriptsAvailable: scriptsCheck.ok,
      scriptsMissing: scriptsCheck.missing,
      backupToken: getOrCreateBackupToken(),
    })
  }

  if (type === 'backups') {
    return NextResponse.json({ files: listAllBackupFiles() })
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action')

  if (action === 'delete') {
    const { file } = await req.json()
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    try {
      deleteBackupFile(file, getAllBackupDirs())
      return NextResponse.json({ ok: true })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
