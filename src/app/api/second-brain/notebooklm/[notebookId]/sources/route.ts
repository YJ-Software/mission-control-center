import { NextRequest, NextResponse } from 'next/server'
import { execNlm, execNlmJson } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const data = await execNlmJson(['source', 'list', notebookId])
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  const { type, value, title } = await req.json()

  const args = ['source', 'add', notebookId]
  if (type === 'url') args.push('--url', value)
  else if (type === 'text') args.push('--text', value)
  else if (type === 'youtube') args.push('--youtube', value)
  else if (type === 'drive') args.push('--drive', value)
  else return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  if (title) args.push('--title', title)
  args.push('--wait')

  try {
    const { stdout } = await execNlm(args, { timeout: 120000 })
    return NextResponse.json({ ok: true, output: stdout.trim() })
  } catch (err: any) {
    return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
  }
}

export async function DELETE(req: NextRequest, _ctx: Ctx) {
  const { sourceIds } = await req.json()
  if (!sourceIds?.length) return NextResponse.json({ error: 'sourceIds required' }, { status: 400 })

  try {
    await execNlm(['source', 'delete', ...sourceIds, '--confirm'])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
