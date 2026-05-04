import { NextRequest, NextResponse } from 'next/server'
import { calendarEvents, calendarCreate, calendarUpdate, calendarDelete } from '@/lib/gogcli'
import { db, initDb } from '@/lib/db'
import { calendarEvents as calendarEventsTable } from '@/lib/schema'

initDb()

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const upcoming = searchParams.get('upcoming')

  let from: string
  let to: string

  if (upcoming === '48h') {
    from = new Date().toISOString()
    to = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  } else {
    from = searchParams.get('from') || new Date(new Date().setDate(new Date().getDate() - 1)).toISOString()
    to = searchParams.get('to') || new Date(new Date().setDate(new Date().getDate() + 30)).toISOString()
  }

  try {
    const data = await calendarEvents(from, to, 50) as { events: Array<{ id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; calendarId: string }> }
    return NextResponse.json({ events: data.events || [] })
  } catch (err) {
    return NextResponse.json({ events: [], error: String(err) })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { calendarId = 'primary', summary, from, to, description } = body

  try {
    const result = await calendarCreate(calendarId, summary, from, to, description)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { calendarId, eventId, summary, from, to } = body

  try {
    const result = await calendarUpdate(calendarId, eventId, summary, from, to)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const calendarId = searchParams.get('calendarId') || 'primary'
  const eventId = searchParams.get('eventId')

  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })

  try {
    await calendarDelete(calendarId, eventId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
