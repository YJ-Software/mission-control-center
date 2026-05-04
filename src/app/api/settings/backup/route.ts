import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'

const execAsync = promisify(exec)

export async function POST() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const backupDir = path.join(os.homedir(), 'mission-control-backups')
    const backupPath = path.join(backupDir, `backup-${timestamp}`)

    fs.mkdirSync(backupPath, { recursive: true })

    // Backup openclaw config
    const openclaw_dir = path.join(os.homedir(), '.openclaw')
    if (fs.existsSync(path.join(openclaw_dir, 'openclaw.json'))) {
      fs.copyFileSync(
        path.join(openclaw_dir, 'openclaw.json'),
        path.join(backupPath, 'openclaw.json')
      )
    }

    // Backup cron jobs
    if (fs.existsSync(path.join(openclaw_dir, 'cron', 'jobs.json'))) {
      fs.copyFileSync(
        path.join(openclaw_dir, 'cron', 'jobs.json'),
        path.join(backupPath, 'cron-jobs.json')
      )
    }

    // Backup SQLite DB
    const dbPath = path.join(os.homedir(), '.mission-control', 'db.sqlite')
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, path.join(backupPath, 'db.sqlite'))
    }

    return NextResponse.json({ ok: true, path: backupPath })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
