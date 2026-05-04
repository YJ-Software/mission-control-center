import { NextResponse } from 'next/server'
import {
  getProviderStatus,
  setProvider,
  testProvider,
  restartGateway,
  type ProviderConfig,
} from '@/lib/customer-service/mem0-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(getProviderStatus())
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const action = body?.action ?? 'save'

  try {
    if (action === 'test') {
      const res = await testProvider()
      return NextResponse.json(res)
    }

    if (action === 'save' || action === 'save-and-restart') {
      const cfg: ProviderConfig = body.config
      if (!cfg || !cfg.mode) {
        return NextResponse.json({ error: 'config required' }, { status: 400 })
      }
      const { output } = await setProvider(cfg)
      let restartOut = ''
      if (action === 'save-and-restart') restartOut = await restartGateway()
      return NextResponse.json({ ok: true, output: output + '\n' + restartOut })
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
