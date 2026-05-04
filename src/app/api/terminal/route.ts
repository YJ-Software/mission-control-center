// src/app/api/terminal/route.ts
import { NextResponse } from 'next/server'
import type { TerminalSessionManager } from '@/lib/terminal/session-manager'

function getManager(): TerminalSessionManager | null {
  return (globalThis as Record<string, unknown>).__terminalManager as TerminalSessionManager | null
}

export async function GET() {
  const manager = getManager()
  if (!manager) {
    return NextResponse.json({ error: 'Terminal not available' }, { status: 503 })
  }
  return NextResponse.json({ sessions: manager.listSessions() })
}

export async function POST() {
  const manager = getManager()
  if (!manager) {
    return NextResponse.json({ error: 'Terminal not available' }, { status: 503 })
  }
  try {
    const session = manager.createSession()
    return NextResponse.json(session, { status: 201 })
  } catch (e) {
    if ((e as Error).message === 'MAX_SESSIONS_REACHED') {
      return NextResponse.json({ error: 'Max sessions reached (5)' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}
