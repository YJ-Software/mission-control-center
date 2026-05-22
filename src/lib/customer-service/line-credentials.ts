import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const KEYS = {
  channelId: 'customer-service.line.channelId',
  channelSecret: 'customer-service.line.channelSecret',
  channelAccessToken: 'customer-service.line.channelAccessToken',
} as const

export interface LineCredentials {
  channelId: string
  channelSecret: string
  channelAccessToken: string
}

function get(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? ''
}

function set(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function readLineCredentials(): LineCredentials {
  // settings DB first; env vars only as a migration crutch for older installs.
  return {
    channelId: get(KEYS.channelId) || process.env.LINE_CHANNEL_ID || '',
    channelSecret: get(KEYS.channelSecret) || process.env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: get(KEYS.channelAccessToken) || process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  }
}

export function writeLineCredentials(creds: Partial<LineCredentials>): void {
  if (typeof creds.channelId === 'string') set(KEYS.channelId, creds.channelId.trim())
  if (typeof creds.channelSecret === 'string') set(KEYS.channelSecret, creds.channelSecret.trim())
  if (typeof creds.channelAccessToken === 'string') set(KEYS.channelAccessToken, creds.channelAccessToken.trim())
}

export function hasLineAccessToken(): boolean {
  return readLineCredentials().channelAccessToken.length > 0
}
