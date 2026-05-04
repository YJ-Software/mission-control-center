/**
 * gogcli integration - wrapper around the gog CLI binary
 */
import { execFile } from 'child_process'
import { execFileSync } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const execFileAsync = promisify(execFile)

function findGogBin(): string {
  // Try common locations via which
  try {
    return execFileSync('which', ['gog'], { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {}

  return 'gog' // fallback to PATH lookup
}

function getGogAccount(): string {
  const row = db.select().from(settings).where(eq(settings.key, 'gog.account')).get()
  return row?.value || ''
}

const GOG_BIN = findGogBin()

async function runGog(args: string[]): Promise<unknown> {
  const account = getGogAccount()
  if (!account) throw new Error('GOG account not configured. Set it in Settings.')

  const env = {
    ...process.env,
    GOG_ACCOUNT: account,
    GOG_KEYRING_BACKEND: 'file',
  }

  const { stdout } = await execFileAsync(GOG_BIN, ['--json', ...args], {
    env,
    timeout: 30000,
  })
  return JSON.parse(stdout)
}

// Gmail
export async function gmailSearch(query: string, max = 10) {
  return runGog(['gmail', 'search', query, '--max', String(max)])
}

export async function gmailThread(threadId: string) {
  return runGog(['gmail', 'thread', 'get', threadId])
}

// Calendar
export async function calendarEvents(from: string, to: string, max = 50) {
  return runGog(['calendar', 'events', '--all', '--from', from, '--to', to, '--max', String(max)])
}

export async function calendarCreate(calendarId: string, summary: string, from: string, to: string, description?: string) {
  const args = ['calendar', 'create', calendarId, '--summary', summary, '--from', from, '--to', to]
  if (description) args.push('--description', description)
  return runGog(args)
}

export async function calendarUpdate(calendarId: string, eventId: string, summary?: string, from?: string, to?: string) {
  const args = ['calendar', 'update', calendarId, eventId]
  if (summary) args.push('--summary', summary)
  if (from) args.push('--from', from)
  if (to) args.push('--to', to)
  return runGog(args)
}

export async function calendarDelete(calendarId: string, eventId: string) {
  return runGog(['calendar', 'delete', calendarId, eventId])
}

export async function calendarsList() {
  return runGog(['calendar', 'calendars'])
}
