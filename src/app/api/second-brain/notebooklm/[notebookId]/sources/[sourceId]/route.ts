import { NextRequest, NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string; sourceId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { sourceId } = await ctx.params
  try {
    const data = await execNlmJson(['source', 'get', sourceId])
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { sourceId } = await ctx.params
  const { title } = await req.json()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  try {
    await execNlm(['source', 'rename', sourceId, '--title', title])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
