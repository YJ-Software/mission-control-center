import { NextRequest } from 'next/server'
import { installObsidian, installHeadlessDeps, installCouchDB, uninstallObsidian, uninstallCouchDB } from '@/lib/second-brain/obsidian/installer'
import type { InstallTarget } from '@/lib/second-brain/obsidian/installer'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

export async function POST(req: NextRequest) {
  const { target, method } = await req.json() as {
    target: InstallTarget
    method?: 'docker' | 'apt'
  }

  // Obsidian UI locale follows the dashboard locale cookie (zh-TW / zh-CN / en)
  const localeCookie = req.cookies.get('locale')?.value
  const locale = ['zh-TW', 'zh-CN', 'en'].includes(localeCookie ?? '') ? localeCookie! : 'zh-TW'

  let stream: ReadableStream<Uint8Array>

  if (target === 'obsidian') {
    stream = installObsidian(locale)
  } else if (target === 'headless-deps') {
    stream = installHeadlessDeps(locale)
  } else if (target === 'couchdb') {
    stream = installCouchDB(method ?? 'docker')
  } else {
    return new Response(JSON.stringify({ error: 'invalid target' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(stream, { headers: SSE_HEADERS })
}

export async function DELETE(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target') || 'all'
  const deleteData = req.nextUrl.searchParams.get('deleteData') === 'true'

  let stream: ReadableStream<Uint8Array>
  if (target === 'couchdb') {
    stream = uninstallCouchDB(deleteData)
  } else {
    stream = uninstallObsidian(deleteData)
  }

  return new Response(stream, { headers: SSE_HEADERS })
}
