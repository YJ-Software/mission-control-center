import { sseEncode } from '@/lib/headless-vnc'
import { runSetup } from '@/lib/second-brain/wiki/setup'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

export async function POST() {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (type: 'log' | 'progress' | 'done' | 'error', data: string) => {
        try {
          controller.enqueue(encoder.encode(sseEncode({ type, data })))
        } catch { /* closed */ }
      }
      try {
        await runSetup((stage, message) => {
          // Map wiki setup's two-arg progress into the SSE shape.
          send(stage === 'error' ? 'error' : 'progress', `[${stage}] ${message}`)
        })
        send('done', 'Wiki + Ollama 安裝完成')
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        send('error', message)
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
