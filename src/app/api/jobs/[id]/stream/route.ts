import { NextRequest } from 'next/server'
import { getJob, readJobLog } from '@/lib/jobs/store'
import { subscribeJob } from '@/lib/jobs/sse'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const meta = await getJob(id)
  if (!meta) return new Response('not found', { status: 404 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // closed
        }
      }

      // Replay current state + existing log lines.
      send('meta', meta)
      const existing = await readJobLog(id)
      for (const line of existing) send('log', line)

      if (meta.status !== 'running' && meta.status !== 'restarting') {
        send('end', meta)
        controller.close()
        return
      }

      const unsubscribe = subscribeJob(id, (ev) => {
        if (ev.type === 'log') send('log', ev.line)
        else if (ev.type === 'meta') send('meta', ev.meta)
        else if (ev.type === 'end') {
          send('end', ev.meta)
          unsubscribe()
          controller.close()
        }
      })

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')) } catch {}
      }, 15000)

      // Clean up when the client disconnects.
      const abort = () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch {}
      }
      _req.signal.addEventListener('abort', abort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
