import { NextResponse } from 'next/server'
import {
  getStatus,
  installAndStart,
  stop,
  remove,
  bindToMcp,
  unbindFromMcp,
  restartGateway,
} from '@/lib/customer-service/mem0-neo4j'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getStatus())
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const action = body?.action
  try {
    if (action === 'install') {
      const { output } = await installAndStart(body.password)
      const bind = await bindToMcp(body.password)
      const restart = await restartGateway()
      return NextResponse.json({ ok: true, output: output + '\n' + bind + '\n' + restart })
    }
    if (action === 'enable') {
      const out = await bindToMcp(body.password)
      const restart = await restartGateway()
      return NextResponse.json({ ok: true, output: out + '\n' + restart })
    }
    if (action === 'disable') {
      const out = await unbindFromMcp()
      const restart = await restartGateway()
      return NextResponse.json({ ok: true, output: out + '\n' + restart })
    }
    if (action === 'stop') {
      const r = await stop()
      return NextResponse.json({ ok: true, output: r.output })
    }
    if (action === 'remove') {
      const r = await remove()
      const out = await unbindFromMcp()
      const restart = await restartGateway()
      return NextResponse.json({ ok: true, output: r.output + '\n' + out + '\n' + restart })
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
