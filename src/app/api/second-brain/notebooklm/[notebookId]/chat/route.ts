import { NextRequest, NextResponse } from 'next/server'
import { execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  const { question, conversationId, sourceIds } = await req.json()

  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const args = ['notebook', 'query', notebookId, question]
  if (conversationId) args.push('-c', conversationId)
  if (sourceIds) args.push('-s', sourceIds)

  try {
    const data = await execNlmJson(args, { timeout: 120000 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
