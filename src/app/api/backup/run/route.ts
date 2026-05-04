import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import { backupJobs, backupDestinations, backupSources, backupLogs } from '@/lib/backup/schema'
import { eq, desc } from 'drizzle-orm'
import { verifyBackupToken, expandHome, getBackupOutputDir } from '@/lib/backup/helpers'
import {
  isBackupRunning, setRunningLogId, runBackup, runExtraBackup, uploadToFtp, deleteBackupFile,
} from '@/lib/backup/scripts'
import path from 'path'

initDb()

export async function POST(req: NextRequest) {
  if (!verifyBackupToken(req)) {
    return NextResponse.json({ error: 'Invalid backup token' }, { status: 401 })
  }

  if (isBackupRunning()) {
    return NextResponse.json({ error: 'A backup is already running' }, { status: 409 })
  }

  const body = await req.json()
  const { jobId } = body

  let job: typeof backupJobs.$inferSelect | undefined
  let destConfig: Record<string, unknown> = {}
  let destType = 'local'
  let destName = 'Local'
  let sourceIds: string[] = []
  let retainCount = 0
  let includeOpenClaw = true

  if (jobId) {
    job = db.select().from(backupJobs).where(eq(backupJobs.id, jobId)).get()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const dest = db.select().from(backupDestinations).where(eq(backupDestinations.id, job.destinationId)).get()
    if (dest) {
      destConfig = JSON.parse(dest.config)
      destType = dest.type
      destName = dest.name
    }
    sourceIds = JSON.parse(job.sourceIds || '[]')
    retainCount = job.retainCount
    includeOpenClaw = job.includeOpenClaw !== 0
  } else {
    const { destinationId, sourceIds: bodySourceIds } = body
    if (destinationId) {
      const dest = db.select().from(backupDestinations).where(eq(backupDestinations.id, destinationId)).get()
      if (dest) {
        destConfig = JSON.parse(dest.config)
        destType = dest.type
        destName = dest.name
      }
    }
    sourceIds = bodySourceIds || []
  }

  // Create log entry
  db.insert(backupLogs).values({
    jobId: jobId || null,
    status: 'processing',
    destination: destName,
  }).run()
  const logEntry = db.select().from(backupLogs)
    .orderBy(desc(backupLogs.id)).limit(1).get()
  const logId = logEntry!.id
  setRunningLogId(logId)

  // Return immediately, run backup in background
  const response = NextResponse.json({ ok: true, logId })

  // Determine output directory from destination config
  const outputDir = destType === 'local' && destConfig.path
    ? expandHome(String(destConfig.path))
    : undefined

  // Fire and forget — background execution
  ;(async () => {
    try {
      let result: Awaited<ReturnType<typeof runBackup>> | undefined

      if (includeOpenClaw) {
        result = await runBackup(outputDir)
      }

      const extraPaths: string[] = []
      for (const sourceId of sourceIds) {
        const source = db.select().from(backupSources).where(eq(backupSources.id, sourceId)).get()
        if (source?.enabled) {
          const targetDir = result ? path.dirname(result.filePath) : (outputDir || getBackupOutputDir())
          const extraResult = await runExtraBackup(source.path, targetDir, source.name)
          if (extraResult.filePath) extraPaths.push(extraResult.filePath)
        }
      }

      if (destType === 'ftp' && destConfig.ip && result) {
        await uploadToFtp(result.filePath, destConfig as Parameters<typeof uploadToFtp>[1])
      }

      db.update(backupLogs).set({
        status: 'completed',
        completedAt: Math.floor(Date.now() / 1000),
        fileSize: result?.size ?? 0,
        filePath: result?.filePath ?? null,
        extraFilePaths: extraPaths.length > 0 ? JSON.stringify(extraPaths) : null,
      }).where(eq(backupLogs.id, logId)).run()

      // Retain cleanup — includes both OpenClaw and extra source files
      if (retainCount > 0 && jobId) {
        const logs = db.select().from(backupLogs)
          .where(eq(backupLogs.jobId, jobId))
          .orderBy(desc(backupLogs.startedAt)).all()
          .filter(l => l.status === 'completed')

        if (logs.length > retainCount) {
          for (const old of logs.slice(retainCount)) {
            if (old.filePath) deleteBackupFile(old.filePath)
            // Clean up extra source backup files
            if (old.extraFilePaths) {
              try {
                const extras: string[] = JSON.parse(old.extraFilePaths)
                for (const fp of extras) deleteBackupFile(fp)
              } catch { /* ignore parse errors */ }
            }
            db.update(backupLogs).set({ status: 'canceled' })
              .where(eq(backupLogs.id, old.id)).run()
          }
        }
      }
    } catch (err) {
      db.update(backupLogs).set({
        status: 'failed',
        completedAt: Math.floor(Date.now() / 1000),
        error: String(err),
      }).where(eq(backupLogs.id, logId)).run()
    } finally {
      setRunningLogId(null)
    }
  })()

  return response
}
