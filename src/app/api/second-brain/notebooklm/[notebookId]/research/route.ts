import { NextRequest, NextResponse } from 'next/server'
import { execNlm } from '@/lib/second-brain/notebooklm/cli'

type Ctx = { params: Promise<{ notebookId: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  try {
    const { stdout } = await execNlm(['research', 'status', notebookId])
    return NextResponse.json({ ok: true, output: stdout.trim() })
  } catch (err: any) {
    const output = ((err.stdout || '') + (err.stderr || '')).trim()
    return NextResponse.json({ ok: false, output })
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  const { action } = await req.json()

  if (action === 'start') {
    try {
      const { stdout } = await execNlm(['research', 'start', notebookId], { timeout: 60000 })
      return NextResponse.json({ ok: true, output: stdout.trim() })
    } catch (err: any) {
      return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
    }
  }

  if (action === 'import') {
    try {
      const { stdout } = await execNlm(['research', 'import', notebookId], { timeout: 60000 })
      return NextResponse.json({ ok: true, output: stdout.trim() })
    } catch (err: any) {
      return NextResponse.json({ ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
