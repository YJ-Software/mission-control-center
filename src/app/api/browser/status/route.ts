import { NextResponse } from 'next/server'
import { getAllServiceStatuses } from '@/lib/browser/service-manager'

export async function GET() {
  try {
    const statuses = getAllServiceStatuses()
    return NextResponse.json(statuses)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
