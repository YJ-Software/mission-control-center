import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const backupDestinations = sqliteTable('backup_destinations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: text('config').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const backupSources = sqliteTable('backup_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const backupSchedules = sqliteTable('backup_schedules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: text('config').notNull().default('{}'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const backupJobs = sqliteTable('backup_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  destinationId: text('destination_id').notNull(),
  scheduleId: text('schedule_id').notNull(),
  retainCount: integer('retain_count').notNull().default(7),
  sourceIds: text('source_ids').notNull().default('[]'),
  includeOpenClaw: integer('include_openclaw').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  cronJobId: text('cron_job_id'),
  model: text('model'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const backupLogs = sqliteTable('backup_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id'),
  status: text('status').notNull().default('pending'),
  startedAt: integer('started_at').notNull().default(sql`(unixepoch())`),
  completedAt: integer('completed_at'),
  fileSize: integer('file_size'),
  filePath: text('file_path'),
  extraFilePaths: text('extra_file_paths'),
  destination: text('destination'),
  notes: text('notes'),
  error: text('error'),
})
