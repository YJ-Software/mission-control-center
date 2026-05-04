import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'
import os from 'os'
import fs from 'fs'

const DB_DIR = path.join(os.homedir(), '.mission-control')
const DB_PATH = path.join(DB_DIR, 'db.sqlite')

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// Run migrations on startup
export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee TEXT,
      project TEXT,
      due_date TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      platform TEXT,
      stage TEXT NOT NULL DEFAULT 'idea',
      script TEXT,
      notes TEXT,
      scheduled_date TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      external_link TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      handle TEXT,
      timezone TEXT,
      compensation TEXT,
      notes TEXT,
      category TEXT NOT NULL DEFAULT 'external',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'task',
      google_event_id TEXT,
      google_calendar_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS morning_report_topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `)

  // Expand morning_report_topics with new columns
  const alterStatements = [
    `ALTER TABLE morning_report_topics ADD COLUMN emoji TEXT DEFAULT '📰'`,
    `ALTER TABLE morning_report_topics ADD COLUMN template TEXT DEFAULT ''`,
    `ALTER TABLE morning_report_topics ADD COLUMN cron_time TEXT DEFAULT '0 8'`,
    `ALTER TABLE morning_report_topics ADD COLUMN timeout_seconds INTEGER DEFAULT 600`,
    `ALTER TABLE morning_report_topics ADD COLUMN output_filename TEXT DEFAULT ''`,
    `ALTER TABLE morning_report_topics ADD COLUMN updated_at INTEGER DEFAULT 0`,
    `ALTER TABLE morning_report_topics ADD COLUMN model TEXT DEFAULT ''`,
    `ALTER TABLE morning_report_topics ADD COLUMN delivery_mode TEXT DEFAULT 'none'`,
  ]
  for (const stmt of alterStatements) {
    try { sqlite.exec(stmt) } catch (err: any) {
      if (!err.message?.includes('duplicate column') && !err.message?.includes('already exists')) {
        console.warn(`Migration warning: ${stmt}`, err.message)
      }
    }
  }

  // Create new morning report tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS morning_report_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS morning_report_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS morning_report_run_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      topic_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,
      completed_at INTEGER,
      output_path TEXT
    );

    CREATE TABLE IF NOT EXISTS morning_report_format_template (
      id INTEGER PRIMARY KEY DEFAULT 1,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `)

  // Create backup tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS backup_destinations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS backup_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS backup_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS backup_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      destination_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      retain_count INTEGER NOT NULL DEFAULT 7,
      source_ids TEXT NOT NULL DEFAULT '[]',
      include_openclaw INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      cron_job_id TEXT,
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      file_size INTEGER,
      file_path TEXT,
      destination TEXT,
      notes TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backup_logs_job_id ON backup_logs(job_id);
  `)

  // Migrate backup_jobs: add include_openclaw column
  try {
    sqlite.exec(`ALTER TABLE backup_jobs ADD COLUMN include_openclaw INTEGER NOT NULL DEFAULT 1`)
  } catch (err: any) {
    if (!err.message?.includes('duplicate column') && !err.message?.includes('already exists')) {
      console.warn('Migration warning: backup_jobs include_openclaw', err.message)
    }
  }

  // Migrate backup_logs: add extra_file_paths column
  try {
    sqlite.exec(`ALTER TABLE backup_logs ADD COLUMN extra_file_paths TEXT`)
  } catch (err: any) {
    if (!err.message?.includes('duplicate column') && !err.message?.includes('already exists')) {
      console.warn('Migration warning: backup_logs extra_file_paths', err.message)
    }
  }

  // Default upgrade manifest URL — fresh installs poll GitHub raw for the
  // public release-manifest.json. Users can override via the settings UI or
  // the UPGRADE_MANIFEST_URL env var.
  sqlite
    .prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('upgrade.manifestUrl', ?)`)
    .run('https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/release-manifest.json')

  // Seed a default local backup destination on first run so the /backup page
  // has something usable immediately. Only runs when the table is completely
  // empty — once the user has ≥1 destination (even after deleting this one),
  // we don't re-create it.
  const destCount = sqlite.prepare('SELECT COUNT(*) AS n FROM backup_destinations').get() as { n: number }
  if (destCount.n === 0) {
    sqlite.prepare(`
      INSERT INTO backup_destinations (id, name, type, config, enabled)
      VALUES ('local-default', ?, 'local', ?, 1)
    `).run('Local (~/backup)', JSON.stringify({ path: '~/backup' }))
  }

  // Seed default morning report topics
  const topicSeeds = [
    { id: 'ai', name: 'AI 科技新聞', emoji: '🤖', sortOrder: 0, cronTime: '0 8', timeout: 600, output: 'morning-report-ai-${TODAY}.md' },
    { id: 'stocks', name: '科技股/產業脈動', emoji: '📈', sortOrder: 1, cronTime: '3 8', timeout: 600, output: 'morning-report-stocks-${TODAY}.md' },
    { id: 'crypto', name: '加密貨幣 + 貴金屬', emoji: '🪙', sortOrder: 2, cronTime: '6 8', timeout: 600, output: 'morning-report-crypto-${TODAY}.md' },
    { id: 'social', name: '社群熱點（X/Reddit/HN）', emoji: '🐦', sortOrder: 3, cronTime: '9 8', timeout: 600, output: 'morning-report-social-${TODAY}.md' },
    { id: 'arxiv', name: '論文 + 新品（arXiv/PH）', emoji: '📄', sortOrder: 4, cronTime: '12 8', timeout: 600, output: 'morning-report-arxiv-${TODAY}.md' },
    { id: 'geo', name: '地緣政治 + 天氣 + 頭條', emoji: '⚔️', sortOrder: 5, cronTime: '15 8', timeout: 600, output: 'morning-report-geo-${TODAY}.md' },
  ]
  const upsertTopic = sqlite.prepare(`
    INSERT OR IGNORE INTO morning_report_topics (id, name, emoji, enabled, sort_order, cron_time, timeout_seconds, output_filename, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, (unixepoch()), (unixepoch()))
  `)
  for (const t of topicSeeds) {
    upsertTopic.run(t.id, t.name, t.emoji, t.sortOrder, t.cronTime, t.timeout, t.output)
  }

  // Seed default morning report config
  const defaultConfigs = [
    ['publicDir', path.join(os.homedir(), 'morning-report/public')],
    ['obsidianDir', ''],
    ['reportBaseUrl', 'https://morning.gbox.tw'],
    ['ttsVoice', 'zh-TW-HsiaoChenNeural'],
    ['ttsEngine', 'edge-tts'],
    ['language', '繁體中文'],
    ['cronModel', ''],
    ['podcastModel', ''],
  ]
  const insertConfig = sqlite.prepare('INSERT OR IGNORE INTO morning_report_config (key, value) VALUES (?, ?)')
  for (const [key, value] of defaultConfigs) {
    insertConfig.run(key, value)
  }
}
