import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getSessionMessages } from '@/lib/sessions'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const messagesFor = searchParams.get('messages')

  if (messagesFor) {
    // A session key, e.g. agent:main:cron:<id>.
    const key = messagesFor.replace(/[^a-zA-Z0-9\-_:.@+]/g, '')
    try {
      const messages = await getSessionMessages(key)
      return NextResponse.json({ messages })
    } catch (err) {
      return NextResponse.json({ messages: [], error: String(err) })
    }
  }

  try {
    const sessions = await getSessions()
    return NextResponse.json({ sessions })
  } catch (err) {
    return NextResponse.json({ sessions: [], error: String(err) })
  }
}
