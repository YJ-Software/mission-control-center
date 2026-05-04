import { NextRequest, NextResponse } from 'next/server'
import { execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const data = await execNlmJson(['notebook', 'describe', notebookId], { timeout: 60000 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
