import { NextRequest } from 'next/server'

type Listener = (data: { step: string; detail: string; timestamp: number }) => void
const listeners: Set<Listener> = new Set()

export function emitProgress(step: string, detail: string) {
  const data = { step, detail, timestamp: Date.now() }
  for (const listener of listeners) {
    listener(data)
  }
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const listener: Listener = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      listeners.add(listener)

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, 15000)

      req.signal.addEventListener('abort', () => {
        listeners.delete(listener)
        clearInterval(heartbeat)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
