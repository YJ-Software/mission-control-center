import { NextRequest, NextResponse } from 'next/server'
import { gmailSearch } from '@/lib/gogcli'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('q') || 'is:unread is:important newer_than:2d'
  const max = parseInt(searchParams.get('max') || '10')

  try {
    const data = await gmailSearch(query, max) as { threads: Array<{ id: string; snippet: string; messages: Array<{ from: string; subject: string; date: string }> }> }
    // Format for display
    const threads = (data.threads || []).map((t) => ({
      id: t.id,
      subject: t.messages?.[0]?.subject || t.snippet?.substring(0, 60) || '(無主旨)',
      from: t.messages?.[0]?.from || '',
      date: t.messages?.[0]?.date || '',
      snippet: t.snippet,
    }))
    return NextResponse.json({ threads })
  } catch (err) {
    return NextResponse.json({ threads: [], error: String(err) })
  }
}
