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

// Customer Service — live conversation feature
//
// One row per LINE user the bot has interacted with. Profile fields are
// hydrated from LINE's getProfile API on first sighting and refreshed lazily
// (>24h). Display rendering falls back to user_id when display_name is empty.
export const csConversations = sqliteTable('cs_conversations', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name'),
  pictureUrl: text('picture_url'),
  language: text('language'),
  lastMessageAt: integer('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  lastDirection: text('last_direction'),    // 'user' | 'bot' | 'operator'
  profileFetchedAt: integer('profile_fetched_at'),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
})

// Append-only message log. We treat LINE-side message_id as optional because
// our own operator sends are echoed back from LINE asynchronously; the
// authoritative id is whichever the LINE API hands us in the push response.
export const csMessages = sqliteTable('cs_messages', {
  id: text('id').primaryKey(),               // local uuid
  userId: text('user_id').notNull(),
  direction: text('direction').notNull(),    // 'user' | 'bot' | 'operator'
  type: text('type').notNull().default('text'),  // 'text' | 'image' | 'sticker' | 'quick_reply' | 'other'
  text: text('text'),
  payload: text('payload'),                  // JSON for rich types (image url, quick reply items, ...)
  lineMessageId: text('line_message_id'),
  operatorId: text('operator_id'),           // who sent it (op user id), nullable
  createdAt: integer('created_at').default(sql`(unixepoch())`),
})

// Per-user "operator has taken over" flag. Resume timer is the auto-resume
// timestamp; gate-plugin treats a row as paused while now() < resume_at.
// Boot restoration loops over rows and schedules setTimeout for any
// resume_at still in the future.
export const csAgentPause = sqliteTable('cs_agent_pause', {
  userId: text('user_id').primaryKey(),
  pausedAt: integer('paused_at').notNull(),
  resumeAt: integer('resume_at').notNull(),
  operatorId: text('operator_id'),
})

export {
  backupDestinations,
  backupSources,
  backupSchedules,
  backupJobs,
  backupLogs,
} from './backup/schema'
