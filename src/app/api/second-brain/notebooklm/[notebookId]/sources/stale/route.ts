import { NextRequest, NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const data = await execNlmJson(['source', 'stale', notebookId])
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const { stdout } = await execNlm(['source', 'sync', notebookId], { timeout: 60000 })
    return NextResponse.json({ ok: true, output: stdout.trim() })
  } catch (err: any) {
    return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
  }
}
