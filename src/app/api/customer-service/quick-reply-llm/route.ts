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
} as const

interface QrLlmConfig {
  useMem0: boolean
  model: string
  baseUrl: string
  apiKey: string         // never returned in plain — masked on GET
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

export async function GET() {
  const raw: QrLlmConfig = {
    useMem0: (get(KEYS.useMem0) || 'true') === 'true',
    model: get(KEYS.model),
    baseUrl: get(KEYS.baseUrl),
    apiKey: get(KEYS.apiKey),
  }
  return NextResponse.json({
    useMem0: raw.useMem0,
    model: raw.model,
    baseUrl: raw.baseUrl,
    apiKey: raw.apiKey ? mask(raw.apiKey) : '',
    hasApiKey: !!raw.apiKey,
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
  return NextResponse.json({ ok: true })
}
