import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('todo'),
  priority: text('priority').notNull().default('medium'),
  assignee: text('assignee'),
  project: text('project'),
  dueDate: text('due_date'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const contentItems = sqliteTable('content_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  platform: text('platform'),
  stage: text('stage').notNull().default('idea'),
  script: text('script'),
  notes: text('notes'),
  scheduledDate: text('scheduled_date'),
  status: text('status').notNull().default('draft'),
  externalLink: text('external_link'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  handle: text('handle'),
  timezone: text('timezone'),
  compensation: text('compensation'),
  notes: text('notes'),
  category: text('category').notNull().default('external'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const calendarEvents = sqliteTable('calendar_events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  category: text('category').notNull().default('task'),
  googleEventId: text('google_event_id'),
  googleCalendarId: text('google_calendar_id'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

export const morningReportTopics = sqliteTable('morning_report_topics', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').default('📰'),
  enabled: integer('enabled').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  template: text('template').default(''),
  cronTime: text('cron_time').default('0 8'),
  timeoutSeconds: integer('timeout_seconds').default(600),
  outputFilename: text('output_filename').default(''),
  model: text('model').default(''),
  deliveryMode: text('delivery_mode').default('none'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
})

export const morningReportConfig = sqliteTable('morning_report_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
})

export const morningReportRuns = sqliteTable('morning_report_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  status: text('status').notNull().default('pending'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  error: text('error'),
})

export const morningReportRunTopics = sqliteTable('morning_report_run_topics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  topicId: text('topic_id').notNull(),
  status: text('status').notNull().default('pending'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  outputPath: text('output_path'),
})

export const morningReportFormatTemplate = sqliteTable('morning_report_format_template', {
  id: integer('id').primaryKey().default(1),
  content: text('content').notNull().default(''),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
})

export {
  backupDestinations,
  backupSources,
  backupSchedules,
  backupJobs,
  backupLogs,
} from './backup/schema'
