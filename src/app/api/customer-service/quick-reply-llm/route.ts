import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEYS = {
  useMem0: 'customer-service.quickReply.llm.useMem0',
  model: 'customer-service.quickReply.llm.model',
  baseUrl: 'customer-service.quickReply.llm.baseUrl',
  apiKey: 'customer-service.quickReply.llm.apiKey',
  count: 'customer-service.quickReply.count',
} as const

const DEFAULT_COUNT = 3
const MIN_COUNT = 1
const MAX_COUNT = 13   // LINE quick reply hard limit per message

interface QrLlmConfig {
  useMem0: boolean
  model: string
  baseUrl: string
  apiKey: string         // never returned in plain — masked on GET
  count: number
}

function get(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? ''
}

function set(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function readCount(): number {
  const v = Number(get(KEYS.count))
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_COUNT
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(v)))
}

export async function GET() {
  return NextResponse.json({
    useMem0: (get(KEYS.useMem0) || 'true') === 'true',
    model: get(KEYS.model),
    baseUrl: get(KEYS.baseUrl),
    apiKey: get(KEYS.apiKey) ? mask(get(KEYS.apiKey)) : '',
    hasApiKey: !!get(KEYS.apiKey),
    count: readCount(),
    countMin: MIN_COUNT,
    countMax: MAX_COUNT,
  })
}

export async function PUT(req: NextRequest) {
  let body: Partial<QrLlmConfig> = {}
  try {
    body = (await req.json()) as Partial<QrLlmConfig>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (typeof body.useMem0 === 'boolean') set(KEYS.useMem0, body.useMem0 ? 'true' : 'false')
  if (typeof body.model === 'string') set(KEYS.model, body.model.trim())
  if (typeof body.baseUrl === 'string') set(KEYS.baseUrl, body.baseUrl.trim())
  if (typeof body.apiKey === 'string') set(KEYS.apiKey, body.apiKey.trim())
  if (typeof body.count === 'number' && Number.isFinite(body.count)) {
    const clamped = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(body.count)))
    set(KEYS.count, String(clamped))
  }
  return NextResponse.json({ ok: true })
}
