import { NextRequest, NextResponse } from 'next/server'
import { readLineCredentials, writeLineCredentials } from '@/lib/customer-service/line-credentials'
import { getBotInfo } from '@/lib/customer-service/line-api'

export const runtime = 'nodejs'

/**
 * Returned shape masks secrets so the UI can show "filled / empty" without
 * exposing the actual token to network observers (CF Tunnel + page load).
 */
function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export async function GET() {
  const c = readLineCredentials()
  return NextResponse.json({
    channelId: c.channelId,                       // numeric id — not sensitive
    channelSecret: c.channelSecret ? mask(c.channelSecret) : '',
    channelAccessToken: c.channelAccessToken ? mask(c.channelAccessToken) : '',
    hasSecret: !!c.channelSecret,
    hasAccessToken: !!c.channelAccessToken,
  })
}

export async function PUT(req: NextRequest) {
  let body: { channelId?: string; channelSecret?: string; channelAccessToken?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  writeLineCredentials(body)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action')
  if (action === 'test') {
    try {
      const info = await getBotInfo()
      return NextResponse.json({ ok: true, info })
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 })
    }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
