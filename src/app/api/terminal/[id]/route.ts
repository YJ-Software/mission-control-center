// src/app/api/terminal/[id]/route.ts
import { NextResponse } from 'next/server'
import type { TerminalSessionManager } from '@/lib/terminal/session-manager'

function getManager(): TerminalSessionManager | null {
  return (globalThis as Record<string, unknown>).__terminalManager as TerminalSessionManager | null
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const manager = getManager()
  if (!manager) {
    return NextResponse.json({ error: 'Terminal not available' }, { status: 503 })
  }
  const deleted = manager.closeSession(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
