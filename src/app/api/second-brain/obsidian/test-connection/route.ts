import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url, user, password } = await req.json()

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Missing URL' }, { status: 400 })
    }

    // Validate URL format
    try { new URL(url) } catch { return NextResponse.json({ ok: false, error: 'Invalid URL' }, { status: 400 }) }

    const headers: Record<string, string> = {}
    if (user) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${password || ''}`).toString('base64')
    }

    const res = await fetch(`${url}/_up`, { headers, signal: AbortSignal.timeout(5000) })
    return NextResponse.json({ ok: res.ok })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 })
  }
}
