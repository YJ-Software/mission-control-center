import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getSessionMessages } from '@/lib/sessions'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const messagesFor = searchParams.get('messages')

  if (messagesFor) {
    const id = messagesFor.replace(/[^a-zA-Z0-9\-_:.]/g, '')
    const messages = getSessionMessages(id)
    return NextResponse.json({ messages })
  }

  try {
    const sessions = getSessions()
    return NextResponse.json({ sessions })
  } catch (err) {
    return NextResponse.json({ sessions: [], error: String(err) })
  }
}
