import { NextRequest, NextResponse } from 'next/server'
import { setObsidianLocale } from '@/lib/second-brain/obsidian/installer'

export async function POST(req: NextRequest) {
  const { locale } = await req.json() as { locale?: string }
  if (!locale) return NextResponse.json({ error: 'locale required' }, { status: 400 })

  try {
    const result = setObsidianLocale(locale)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
