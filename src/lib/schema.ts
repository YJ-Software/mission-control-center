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
  /** JSON array of news_feeds ids this topic draws candidates from. */
  feedIds: text('feed_ids').notNull().default('[]'),
  /** 'search' (agent searches, the original behaviour) | 'feed+search' |
   *  'feed' (only the linked sources). */
  sourceMode: text('source_mode').notNull().default('search'),
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

// Dashboard-wide notification feed (header bell + toast). Producers:
// MCC upgrade check, OpenClaw upgrade, cs storage threshold, future
// alerts. Read-state is per-row; "cleared" = deleted.
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),                  // 'mcc-upgrade' | 'openclaw-upgrade' | 'cs-storage' | 'system'
  severity: text('severity').notNull().default('info'),  // 'info' | 'warning' | 'error'
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  // Dedup key — producers set this to avoid spamming the bell. Pair with
  // a unique index so an upsert behaves like "create-once-until-cleared".
  dedupKey: text('dedup_key'),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  readAt: integer('read_at'),
})

// Edit history for every operator-editable template: per-topic prompts, the
// shared FORMAT block, and the message/HTML/script templates kept in
// morning_report_config. One table for all of them — `scope` says which kind,
// `refId` which one.
//
// The motivating case is "還原預設", which rewrites every topic's template in a
// single click; without history that is unrecoverable.
export const morningReportTemplateVersions = sqliteTable('morning_report_template_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 'topic' → refId is the topic id
  // 'format' → refId is 'format' (the single shared FORMAT block)
  // 'config' → refId is the morning_report_config key (finalizeMessageTemplate…)
  scope: text('scope').notNull(),
  refId: text('ref_id').notNull(),
  content: text('content').notNull(),
  // sha256 of content. Compared against the newest row for this ref so
  // repeated saves of unchanged text don't pile up junk versions.
  contentHash: text('content_hash').notNull(),
  // How this version came about: 'baseline' is the pre-existing value captured
  // the first time a ref is versioned, so the original survives a first edit.
  origin: text('origin').notNull().default('save'), // 'baseline' | 'save' | 'reset-default' | 'restore'
  note: text('note'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

// News link ledger. One table doing two jobs, told apart by used_in_report:
//   NULL          → a candidate fetched from a source, not yet used
//   '2026-07-26'  → cited by that day's report
//
// The citation half replaces the old dedup, which scanned yesterday's files in
// tmp/ with a regex: it only looked back one day, died when tmp was cleaned at
// seven, and compared raw strings so `?utm_source=rss` read as a new article.
//
// Columns beyond what today's dedup needs (feed_id, title, snippet, simhash)
// are carried now so the RSS intake and near-duplicate passes land without a
// migration.
export const newsArticles = sqliteTable('news_articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // sha256 of the normalised URL, UNIQUE. Exact dedup is then an index lookup
  // and an INSERT … ON CONFLICT, with no comparison logic in the app at all.
  urlHash: text('url_hash').notNull().unique(),
  url: text('url').notNull(),
  // As received — keeps a Google redirect around when unwrapping misfires.
  rawUrl: text('raw_url'),
  host: text('host').notNull(),
  title: text('title').notNull().default(''),
  snippet: text('snippet').default(''),
  simhash: text('simhash'),
  source: text('source').notNull().default('report'), // 'report' | 'google-alerts' | 'manual'
  feedId: text('feed_id'),
  publishedAt: integer('published_at'),
  fetchedAt: integer('fetched_at').notNull().default(sql`(unixepoch())`),
  /** yyyy-MM-dd of the report that cited it; NULL while it is only a candidate. */
  usedInReport: text('used_in_report'),
})

// Registered news sources (Google Alerts and any other RSS/Atom feed).
//
// `url` is a capability URL: a Google Alerts feed address needs no
// authentication, so anyone holding it can read the operator's alerts. Treat
// it as a secret — the API masks it in listings, and it must never reach a
// prompt file or the client bundle in full.
export const newsFeeds = sqliteTable('news_feeds', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  url: text('url').notNull(),
  enabled: integer('enabled').notNull().default(1),
  lastFetchedAt: integer('last_fetched_at'),
  lastStatus: text('last_status'),   // 'ok' | 'error'
  lastError: text('last_error'),
  lastItemCount: integer('last_item_count').default(0),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

export {
  backupDestinations,
  backupSources,
  backupSchedules,
  backupJobs,
  backupLogs,
} from './backup/schema'
