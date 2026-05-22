import { NextRequest, NextResponse } from 'next/server'
import { isPaused, getPause } from '@/lib/customer-service/cs-store'

export const runtime = 'nodejs'

/**
 * Lightweight probe used by the business-hours-gate plugin on every inbound
 * LINE event. Returns within ~1ms (single sqlite point read). The plugin
 * sets a 200ms timeout — if MCC is down, plugin lets the agent reply
 * normally (fail-open).
 */
export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ paused: false }, { status: 400 })
  return NextResponse.json({
    paused: isPaused(userId),
    pauseInfo: getPause(userId),
  })
}
