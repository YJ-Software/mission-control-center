import { NextResponse } from 'next/server'
import {
  getStatus,
  installPlugin,
  uninstallPlugin,
  saveConfig,
  restartGateway,
  type GateConfig,
} from '@/lib/customer-service/business-hours-gate'

export async function GET() {
  try {
    const status = await getStatus()
    return NextResponse.json(status)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
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
      case 'install': {
        const { output } = await installPlugin()
        const restartOutput = await restartGateway()
        return NextResponse.json({ ok: true, output: output + '\n' + restartOutput })
      }
      case 'uninstall': {
        const { output } = await uninstallPlugin()
        const restartOutput = await restartGateway()
        return NextResponse.json({ ok: true, output: output + '\n' + restartOutput })
      }
      case 'save': {
        const config = saveConfig(body.config as GateConfig)
        return NextResponse.json({ ok: true, config })
      }
      case 'save-and-restart': {
        const config = saveConfig(body.config as GateConfig)
        const restartOutput = await restartGateway()
        return NextResponse.json({ ok: true, config, output: restartOutput })
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
