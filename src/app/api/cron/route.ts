import { NextRequest, NextResponse } from 'next/server'
import {
  cronList,
  cronAdd,
  cronEdit,
  cronEnable,
  cronDisable,
  cronRemove,
} from '@/lib/morning-report/cron-cli'

export async function GET() {
  try {
    const jobs = await cronList()
    return NextResponse.json({ jobs })
  } catch (err) {
    return NextResponse.json({ jobs: [], error: String(err) })
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const {
    id, enabled, name, schedule, at, every, payload,
    timezone, session, deliveryMode, channel, to,
    bestEffort, agentId, clearAgent, thinking, stagger,
    exact, deleteAfterRun, wake,
  } = body

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    // Simple enable/disable toggle (backwards compatible)
    if (enabled !== undefined && !name && !schedule && !at && !every && !payload &&
        !timezone && !session && !deliveryMode && !agentId && !thinking) {
      if (enabled) await cronEnable(id)
      else await cronDisable(id)
      return NextResponse.json({ ok: true })
    }

    // Partial update via edit
    const editOpts: Record<string, any> = {}
    if (name !== undefined) editOpts.name = name
    if (schedule !== undefined) editOpts.cron = schedule
    if (at !== undefined) editOpts.at = at
    if (every !== undefined) editOpts.every = every
    if (enabled === true) editOpts.enabled = true
    if (enabled === false) editOpts.enabled = false
    if (timezone !== undefined) editOpts.tz = timezone
    if (session !== undefined) editOpts.session = session
    if (deliveryMode !== undefined) editOpts.deliveryMode = deliveryMode
    if (channel !== undefined) editOpts.channel = channel
    if (to !== undefined) editOpts.to = to
    if (bestEffort !== undefined) editOpts.bestEffort = bestEffort
    if (agentId !== undefined) editOpts.agentId = agentId
    if (clearAgent !== undefined) editOpts.clearAgent = clearAgent
    if (thinking !== undefined) editOpts.thinking = thinking
    if (stagger !== undefined) editOpts.stagger = stagger
    if (exact !== undefined) editOpts.exact = exact
    if (deleteAfterRun !== undefined) editOpts.deleteAfterRun = deleteAfterRun
    if (wake !== undefined) editOpts.wake = wake
    if (payload?.message !== undefined) editOpts.message = payload.message
    if (payload?.systemEvent !== undefined) editOpts.systemEvent = payload.systemEvent
    if (payload?.model !== undefined) editOpts.model = payload.model
    if (payload?.thinking !== undefined) editOpts.thinking = payload.thinking
    if (payload?.timeoutSeconds !== undefined) editOpts.timeoutSeconds = payload.timeoutSeconds

    await cronEdit(id, editOpts)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/cron] error for id:', id, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    name, schedule, at, every, model, message, systemEvent,
    timeoutSeconds, timezone, channel, to, session, thinking,
    agentId, deliveryMode, bestEffort, deleteAfterRun, wake,
    stagger, exact,
  } = body

  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  if (!schedule && !at && !every) {
    return NextResponse.json({ error: 'schedule, at, or every required' }, { status: 400 })
  }

  try {
    const id = await cronAdd({
      name,
      cron: schedule,
      at,
      every,
      tz: timezone ?? 'Asia/Taipei',
      session: session ?? 'isolated',
      message: message ?? '',
      systemEvent,
      model: model || undefined,
      thinking,
      timeoutSeconds: timeoutSeconds ?? 300,
      agentId,
      deliveryMode,
      channel: channel ?? 'last',
      to,
      bestEffort,
      deleteAfterRun,
      wake,
      stagger,
      exact,
    })

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    await cronRemove(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
