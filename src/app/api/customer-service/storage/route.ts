import { NextRequest, NextResponse } from 'next/server'
import { readStorageSettings, writeStorageSettings, getStorageStats, runRetentionSweep } from '@/lib/customer-service/cs-storage'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    settings: readStorageSettings(),
    stats: getStorageStats(),
  })
}

export async function PUT(req: NextRequest) {
  let body: { retentionDays?: number | 'never'; warnThresholdMb?: number } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  writeStorageSettings(body)
  return NextResponse.json({ ok: true, settings: readStorageSettings() })
}

export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action')
  if (action === 'sweep') {
    const result = runRetentionSweep()
    return NextResponse.json({ ok: true, ...result })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
