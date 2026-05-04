import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { like } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get('prefix')

  try {
    const rows = prefix
      ? db.select().from(settings).where(like(settings.key, `${prefix}%`)).all()
      : db.select().from(settings).all()

    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>
    for (const [key, value] of Object.entries(body)) {
      db.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run()
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
