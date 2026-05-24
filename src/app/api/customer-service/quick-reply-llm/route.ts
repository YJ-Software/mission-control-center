import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COUNT_KEY = 'customer-service.quickReply.count'
const DEFAULT_COUNT = 3
const MIN_COUNT = 1
const MAX_COUNT = 13   // LINE quick reply hard limit per message

function get(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? ''
}

function set(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

function readCount(): number {
  const v = Number(get(COUNT_KEY))
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_COUNT
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(v)))
}

export async function GET() {
  return NextResponse.json({
    count: readCount(),
    countMin: MIN_COUNT,
    countMax: MAX_COUNT,
  })
}

export async function PUT(req: NextRequest) {
  let body: { count?: number } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (typeof body.count === 'number' && Number.isFinite(body.count)) {
    const clamped = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(body.count)))
    set(COUNT_KEY, String(clamped))
  }
  return NextResponse.json({ ok: true })
}
