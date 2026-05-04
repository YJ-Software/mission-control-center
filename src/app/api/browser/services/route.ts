import { NextRequest, NextResponse } from 'next/server'
import { serviceAction, ChromeServiceName } from '@/lib/browser/service-manager'

export async function POST(req: NextRequest) {
  try {
    const { name, action } = await req.json() as {
      name: ChromeServiceName
      action: 'start' | 'stop' | 'restart'
    }
    if (!name || !action) {
      return NextResponse.json({ error: 'missing name or action' }, { status: 400 })
    }
    const result = await serviceAction(name, action)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
