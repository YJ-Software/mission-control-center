import { NextResponse } from 'next/server'
import {
  getStatus,
  applyPatch,
  installDropin,
  reloadAndRestart,
} from '@/lib/customer-service/line-patch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const action = body?.action
  try {
    if (action === 'apply') {
      const out = await applyPatch()
      const restart = await reloadAndRestart()
      return NextResponse.json({ ok: true, output: out.output + '\n' + restart })
    }
    if (action === 'install-dropin') {
      const out = installDropin()
      const restart = await reloadAndRestart()
      return NextResponse.json({ ok: true, output: out.output + '\n' + restart })
    }
    if (action === 'apply-and-install-dropin') {
      const a = await applyPatch()
      const b = installDropin()
      const restart = await reloadAndRestart()
      return NextResponse.json({ ok: true, output: a.output + '\n' + b.output + '\n' + restart })
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
