import { NextRequest } from 'next/server'
import { installChrome, installHeadlessDepsOnly, installOpencliOnly, uninstallChrome } from '@/lib/browser/installer'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

export async function POST(req: NextRequest) {
  const { target } = await req.json() as {
    target: 'chrome' | 'headless-deps' | 'opencli'
  }

  let stream: ReadableStream<Uint8Array>

  if (target === 'chrome') {
    stream = installChrome()
  } else if (target === 'headless-deps') {
    stream = installHeadlessDepsOnly()
  } else if (target === 'opencli') {
    stream = installOpencliOnly()
  } else {
    return new Response(JSON.stringify({ error: 'invalid target' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(stream, { headers: SSE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const deleteData = req.nextUrl.searchParams.get('deleteData') === 'true'
  const stream = uninstallChrome(deleteData)
  return new Response(stream, { headers: SSE_HEADERS })
}
