import { getRecentEvents, watchLive } from '@/lib/live-feed'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send connected status
      controller.enqueue(encoder.encode('data: {"status":"connected"}\n\n'))

      // Send recent events
      const recent = getRecentEvents(20)
      for (const event of recent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      // Watch for new events
      const watcher = watchLive()
      watcher.onEvent(event => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          watcher.close()
        }
      })

      // Send keepalive every 30s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepalive)
        }
      }, 30000)

      // Cleanup on cancel
      const origCancel = controller.close.bind(controller)
      const cleanup = () => {
        clearInterval(keepalive)
        watcher.close()
      }

      // Handle client disconnect via signal
      if (typeof AbortSignal !== 'undefined') {
        const checkClosed = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(''))
          } catch {
            cleanup()
            clearInterval(checkClosed)
          }
        }, 5000)
      }

      // Store cleanup for cancel
      ;(controller as unknown as Record<string, unknown>)._cleanup = () => {
        cleanup()
        try { origCancel() } catch {}
      }
    },
    cancel() {
      // Controller cleanup handled above
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
