import { NextRequest, NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const data = await execNlmJson(['notebook', 'get', notebookId])
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  const { title } = await req.json()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  try {
    await execNlm(['notebook', 'rename', notebookId, '--title', title])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    await execNlm(['notebook', 'delete', notebookId])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
