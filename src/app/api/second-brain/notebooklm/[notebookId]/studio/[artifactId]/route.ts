import { NextRequest, NextResponse } from 'next/server'
import { execNlm } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string; artifactId: string }> }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { artifactId } = await ctx.params
  const { title } = await req.json()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  try {
    await execNlm(['studio', 'rename', artifactId, '--title', title])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { artifactId } = await ctx.params
  try {
    await execNlm(['studio', 'delete', artifactId])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
