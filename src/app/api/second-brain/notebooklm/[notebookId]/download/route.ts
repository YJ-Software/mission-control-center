import { NextRequest, NextResponse } from 'next/server'
import { execNlm } from '@/lib/second-brain/notebooklm/cli'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

type Ctx = { params: Promise<{ notebookId: string }> }

const DOWNLOAD_TYPES: Record<string, { ext: string; mime: string }> = {
  'audio': { ext: 'wav', mime: 'audio/wav' },
  'video': { ext: 'mp4', mime: 'video/mp4' },
  'slide-deck': { ext: 'pdf', mime: 'application/pdf' },
  'infographic': { ext: 'png', mime: 'image/png' },
  'report': { ext: 'md', mime: 'text/markdown' },
  'mind-map': { ext: 'json', mime: 'application/json' },
  'data-table': { ext: 'csv', mime: 'text/csv' },
  'quiz': { ext: 'md', mime: 'text/markdown' },
  'flashcards': { ext: 'md', mime: 'text/markdown' },
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { notebookId } = await ctx.params
  const type = req.nextUrl.searchParams.get('type')
  if (!type || !DOWNLOAD_TYPES[type]) {
    return NextResponse.json({ error: 'Invalid type', validTypes: Object.keys(DOWNLOAD_TYPES) }, { status: 400 })
  }

  const { ext, mime } = DOWNLOAD_TYPES[type]
  const tmpFile = join(tmpdir(), `nlm-dl-${randomBytes(8).toString('hex')}.${ext}`)

  try {
    await execNlm(['download', type, notebookId, '-o', tmpFile], { timeout: 120000 })

    if (!existsSync(tmpFile)) {
      return NextResponse.json({ error: 'Download produced no file' }, { status: 500 })
    }

    const data = readFileSync(tmpFile)
    unlinkSync(tmpFile)

    return new NextResponse(data, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="notebooklm-${type}.${ext}"`,
        'Content-Length': String(data.length),
      },
    })
  } catch (err: any) {
    // Clean up temp file on error
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile) } catch { /* ignore */ }
    return NextResponse.json({ error: (err.stderr || err.message || '').trim() }, { status: 500 })
  }
}
