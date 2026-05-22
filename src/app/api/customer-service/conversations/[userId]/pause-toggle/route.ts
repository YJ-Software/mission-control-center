import { NextRequest, NextResponse } from 'next/server'
import { isPaused, setPause, clearPause, getPause } from '@/lib/customer-service/cs-store'
import { scheduleAutoResume, cancelAutoResume } from '@/lib/customer-service/cs-resume-timers'

export const runtime = 'nodejs'

const PAUSE_MS = 30 * 60 * 1000

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  let body: { paused?: boolean; operatorId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // Empty body → toggle current state
  }

  const currentlyPaused = isPaused(userId)
  const target = typeof body.paused === 'boolean' ? body.paused : !currentlyPaused

  if (target) {
    const pause = setPause(userId, PAUSE_MS, body.operatorId)
    scheduleAutoResume(userId, pause.resumeAt)
    return NextResponse.json({ ok: true, paused: true, pauseInfo: pause })
  } else {
    cancelAutoResume(userId)
    clearPause(userId)
    return NextResponse.json({ ok: true, paused: false, pauseInfo: null })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return NextResponse.json({ paused: isPaused(userId), pauseInfo: getPause(userId) })
}
