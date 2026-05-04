import { db } from '@/lib/db'
import { backupJobs, backupSchedules } from './schema'
import { eq } from 'drizzle-orm'
import { cronList, cronRemove, cronAdd } from '@/lib/morning-report/cron-cli'
import { scheduleToCron, getOrCreateBackupToken } from './helpers'

const BACKUP_PREFIX = '💾'

export async function syncBackupCron(): Promise<void> {
  // 1. Read all enabled jobs
  const jobs = db.select().from(backupJobs).where(eq(backupJobs.enabled, 1)).all()

  // 2. Fetch existing cron jobs and delete backup ones
  try {
    const existing = await cronList()
    const backupCrons = existing.filter(j => j.name?.startsWith(BACKUP_PREFIX))
    for (const cron of backupCrons) {
      try { await cronRemove(cron.id) } catch { /* ignore */ }
    }
  } catch { /* Gateway not available, skip cleanup */ }

  // 3. Recreate cron jobs for each enabled job
  const token = getOrCreateBackupToken()

  for (const job of jobs) {
    const schedule = db.select().from(backupSchedules)
      .where(eq(backupSchedules.id, job.scheduleId)).get()
    if (!schedule) continue

    const config = JSON.parse(schedule.config)
    const cronExpr = scheduleToCron(schedule.type, config)

    try {
      const cronJobId = await cronAdd({
        name: `${BACKUP_PREFIX} Backup: ${job.name}`,
        description: '此任務由備份系統管理，不建議手動變更',
        cron: cronExpr,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        session: 'isolated',
        model: job.model || undefined,
        message: `請立即執行以下 shell 命令（不要解釋，直接執行）：\n\ncurl -s -X POST http://localhost:3737/api/backup/run -H "Content-Type: application/json" -H "X-Backup-Token: ${token}" -d '{"jobId":"${job.id}"}'`,
        timeoutSeconds: 600,
        deliveryMode: 'none',
      })

      // Update cronJobId in DB
      db.update(backupJobs)
        .set({ cronJobId, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(backupJobs.id, job.id))
        .run()
    } catch (err) {
      console.error(`Failed to create cron for backup job ${job.name}:`, err)
    }
  }
}
