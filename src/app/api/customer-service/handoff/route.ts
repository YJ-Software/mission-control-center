import { NextResponse } from 'next/server'
import {
  getStatus,
  saveConfig,
  restartGateway,
  type HandoffConfig,
} from '@/lib/customer-service/handoff-config'

export async function GET() {
  try {
    return NextResponse.json(getStatus())
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  const action: string | undefined = body?.action
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  try {
    switch (action) {
      case 'save': {
        const config = saveConfig(body.config as HandoffConfig)
        return NextResponse.json({ ok: true, config })
      }
      case 'save-and-restart': {
        const config = saveConfig(body.config as HandoffConfig)
        const output = await restartGateway()
        return NextResponse.json({ ok: true, config, output })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500 },
    )
  }
}
