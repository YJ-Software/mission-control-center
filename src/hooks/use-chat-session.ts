import { useState, useCallback, useEffect, useRef } from 'react'
import { useWebSocket, type ChatEventPayload, type ToolStreamPayload } from '@/store/websocket'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolCallId: string
  name: string
  args?: unknown
  output?: string
  status: 'running' | 'completed'
  startedAt: number
}

export interface ChatAttachment {
  fileName?: string
  mimeType?: string
  /** Data URL (data:<mime>;base64,<payload>) — used for local preview. */
  dataUrl: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  state?: 'streaming' | 'complete' | 'error' | 'aborted'
  /** Tool calls made in this assistant message */
  toolCalls?: ToolCall[]
  /** User-uploaded attachments (images) — only present on optimistic local sends. */
  attachments?: ChatAttachment[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripWrapperTags(text: string): string {
  return text.replace(/^<(?:final|delta|error|aborted)>\n?/i, '').replace(/\n?<\/(?:final|delta|error|aborted)>$/i, '').trim()
}

/** Extract text content from a message content array, ignoring tool_use blocks */
function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter(c => c.type === 'text' || !c.type)
    .map(c => c.text || '')
    .join('')
}

/** Extract tool_use/toolCall blocks from a message content array */
function extractToolCalls(content: Array<{ type: string; text?: string; name?: string; input?: unknown; arguments?: unknown; id?: string }>): ToolCall[] {
  const types = ['tool_use', 'toolcall', 'tool_call', 'toolCall']
  return content
    .filter(c => types.includes(c.type))
    .map(c => ({
      toolCallId: c.id || '',
      name: c.name || 'tool',
      args: c.input || c.arguments,
      status: 'completed' as const,
      startedAt: 0,
    }))
}

/** Truncate tool output for display */
function summarizeOutput(output: unknown): string {
  if (output === undefined || output === null) return ''
  const str = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  return str
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatSession(sessionKey: string | null) {
  const { sendRpc, addChatListener, addToolStreamListener, connected } = useWebSocket()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const currentRunIdRef = useRef<string | null>(null)
  const streamingTextRef = useRef('')
  // Track active tool calls for the current streaming message
  const activeToolCallsRef = useRef<Map<string, ToolCall>>(new Map())
  const deletedIdsRef = useRef<Set<string>>(new Set())

  // Load deleted IDs from localStorage when sessionKey changes
  useEffect(() => {
    if (!sessionKey) { deletedIdsRef.current.clear(); return }
    try {
      const raw = localStorage.getItem(`chat-deleted-${sessionKey}`)
      if (raw) deletedIdsRef.current = new Set(JSON.parse(raw))
      else deletedIdsRef.current.clear()
    } catch {
      deletedIdsRef.current.clear()
    }
  }, [sessionKey])

  const refreshHistory = useCallback(() => {
    if (!sessionKey || !connected) return
    setMessages([])
    setStreamingText('')
    streamingTextRef.current = ''
    setIsStreaming(false)
    activeToolCallsRef.current.clear()

    sendRpc('chat.history', { sessionKey, limit: 200 })
      .then((result: unknown) => {
        const data = result as { messages?: Array<{ role: string; content: unknown; timestamp?: number; toolCallId?: string; tool_call_id?: string }> } | null
        if (Array.isArray(data?.messages)) {
          const history: ChatMessage[] = []
          for (let i = 0; i < data.messages.length; i++) {
            const m = data.messages[i]
            const contentArr = Array.isArray(m.content) ? m.content as Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string; tool_use_id?: string; content?: unknown }> : null
            const isToolResult = m.role === 'tool' || m.role === 'tool_result' || m.role === 'toolResult' || !!m.toolCallId || !!m.tool_call_id

            if (isToolResult) {
              // Tool result message — attach output to the previous assistant message's matching tool call
              const toolCallId = m.toolCallId || m.tool_call_id || ''
              const outputText = contentArr
                ? extractText(contentArr)
                : typeof m.content === 'string' ? m.content : ''

              // Find and update the tool call in history (search backwards)
              for (let j = history.length - 1; j >= 0; j--) {
                const tc = history[j].toolCalls?.find(t => t.toolCallId === toolCallId)
                if (tc) {
                  tc.output = outputText
                  break
                }
              }
              continue
            }

            const msgId = `hist-${i}`
            if (deletedIdsRef.current.has(msgId)) continue

            // Regular user or assistant message
            const text = stripWrapperTags(
              contentArr
                ? extractText(contentArr)
                : typeof m.content === 'string' ? m.content : ''
            )
            const toolCalls = contentArr ? extractToolCalls(contentArr) : []

            history.push({
              id: msgId,
              role: m.role as 'user' | 'assistant',
              content: text,
              timestamp: m.timestamp || Date.now(),
              state: 'complete',
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            })
          }
          setMessages(history)
        }
      })
      .catch(() => {})
  }, [sessionKey, connected, sendRpc])

  // Load history when sessionKey or connection changes
  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Subscribe to chat events (delta/final/error/aborted)
  useEffect(() => {
    if (!sessionKey) return

    const unsubscribe = addChatListener((payload: ChatEventPayload) => {
      if (payload.sessionKey !== sessionKey) return

      if (payload.state === 'delta') {
        setIsStreaming(true)
        currentRunIdRef.current = payload.runId
        const content = payload.message?.content || []
        const text = stripWrapperTags(extractText(content))
        streamingTextRef.current = text
        setStreamingText(text)
      } else if (payload.state === 'final') {
        const msgId = `res-${payload.runId}`
        const content = payload.message?.content || []
        const text = stripWrapperTags(extractText(content))
        const toolCalls = extractToolCalls(content)
        // Merge any active tool stream data
        const streamedTools = Array.from(activeToolCallsRef.current.values())
        const allTools = mergeToolCalls(toolCalls, streamedTools)

        setMessages(prev => {
          if (prev.some(m => m.id === msgId)) return prev
          return [...prev, {
            id: msgId,
            role: 'assistant' as const,
            content: text,
            timestamp: payload.message?.timestamp || Date.now(),
            state: 'complete' as const,
            toolCalls: allTools.length > 0 ? allTools : undefined,
          }]
        })
        streamingTextRef.current = ''
        setStreamingText('')
        setIsStreaming(false)
        currentRunIdRef.current = null
        activeToolCallsRef.current.clear()
      } else if (payload.state === 'error') {
        const msgId = `err-${payload.runId}`
        setMessages(prev => {
          if (prev.some(m => m.id === msgId)) return prev
          return [...prev, {
            id: msgId,
            role: 'assistant' as const,
            content: payload.errorMessage || 'Error',
            timestamp: Date.now(),
            state: 'error' as const,
          }]
        })
        streamingTextRef.current = ''
        setStreamingText('')
        setIsStreaming(false)
        currentRunIdRef.current = null
        activeToolCallsRef.current.clear()
      } else if (payload.state === 'aborted') {
        const msgId = `abort-${payload.runId}`
        const abortedText = streamingTextRef.current
        const streamedTools = Array.from(activeToolCallsRef.current.values())
        if (abortedText || streamedTools.length > 0) {
          setMessages(prev => {
            if (prev.some(m => m.id === msgId)) return prev
            return [...prev, {
              id: msgId,
              role: 'assistant' as const,
              content: abortedText,
              timestamp: Date.now(),
              state: 'aborted' as const,
              toolCalls: streamedTools.length > 0 ? streamedTools : undefined,
            }]
          })
        }
        streamingTextRef.current = ''
        setStreamingText('')
        setIsStreaming(false)
        currentRunIdRef.current = null
        activeToolCallsRef.current.clear()
      }
    })

    return unsubscribe
  }, [sessionKey, addChatListener])

  // Subscribe to tool stream events
  useEffect(() => {
    if (!sessionKey) return

    const unsubscribe = addToolStreamListener((payload: ToolStreamPayload) => {
      if (payload.sessionKey && payload.sessionKey !== sessionKey) return

      const { toolCallId, name, phase, args, result, partialResult } = payload.data
      if (!toolCallId) return

      const existing = activeToolCallsRef.current.get(toolCallId)

      if (phase === 'start') {
        activeToolCallsRef.current.set(toolCallId, {
          toolCallId,
          name,
          args,
          status: 'running',
          startedAt: payload.ts || Date.now(),
        })
      } else if (phase === 'update') {
        if (existing) {
          existing.output = summarizeOutput(partialResult)
        }
      } else if (phase === 'result') {
        if (existing) {
          existing.output = summarizeOutput(result)
          existing.status = 'completed'
        } else {
          activeToolCallsRef.current.set(toolCallId, {
            toolCallId,
            name,
            args,
            output: summarizeOutput(result),
            status: 'completed',
            startedAt: payload.ts || Date.now(),
          })
        }
      }

      // Force re-render to show tool progress
      setStreamingText(prev => prev + '') // trigger re-render
    })

    return unsubscribe
  }, [sessionKey, addToolStreamListener])

  const sendMessage = useCallback(async (text: string, attachments?: ChatAttachment[]) => {
    if (!sessionKey) return
    const hasText = text.trim().length > 0
    const hasAttachments = !!attachments && attachments.length > 0
    if (!hasText && !hasAttachments) return

    const idempotencyKey = Math.random().toString(36).substring(2) + Date.now().toString(36)

    setMessages(prev => [...prev, {
      id: idempotencyKey,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      state: 'complete',
      attachments: hasAttachments ? attachments : undefined,
    }])

    // Show loading indicator immediately
    setIsStreaming(true)

    try {
      const rpcAttachments = hasAttachments
        ? attachments!.map(att => {
            const match = att.dataUrl.match(/^data:([^;]+);base64,(.*)$/)
            const mimeType = att.mimeType || (match ? match[1] : undefined)
            const content = match ? match[2] : att.dataUrl
            return {
              type: 'image',
              mimeType,
              fileName: att.fileName,
              content,
            }
          })
        : undefined

      await sendRpc('chat.send', {
        sessionKey,
        message: text,
        deliver: true,
        idempotencyKey,
        ...(rpcAttachments ? { attachments: rpcAttachments } : {}),
      })
    } catch (err) {
      setIsStreaming(false)
      setMessages(prev => [...prev, {
        id: `err-${idempotencyKey}`,
        role: 'assistant',
        content: `Failed to send: ${err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)}`,
        timestamp: Date.now(),
        state: 'error',
      }])
    }
  }, [sessionKey, sendRpc])

  const abortResponse = useCallback(async () => {
    if (!sessionKey) return
    try {
      await sendRpc('chat.abort', {
        sessionKey,
        runId: currentRunIdRef.current || undefined,
      })
    } catch {}
  }, [sessionKey, sendRpc])

  const deleteMessage = useCallback((id: string) => {
    if (!sessionKey) return
    deletedIdsRef.current.add(id)
    localStorage.setItem(`chat-deleted-${sessionKey}`, JSON.stringify([...deletedIdsRef.current]))
    setMessages(prev => prev.filter(m => m.id !== id))
  }, [sessionKey])

  // Get active tool calls for streaming display
  const activeToolCalls = Array.from(activeToolCallsRef.current.values())

  return {
    messages,
    isStreaming,
    streamingText,
    activeToolCalls,
    sendMessage,
    abortResponse,
    deleteMessage,
    refreshHistory,
    connected,
  }
}

// ---------------------------------------------------------------------------
// Merge tool calls from content blocks + streamed tool events
// ---------------------------------------------------------------------------

function mergeToolCalls(fromContent: ToolCall[], fromStream: ToolCall[]): ToolCall[] {
  const map = new Map<string, ToolCall>()
  for (const tc of fromContent) {
    if (tc.toolCallId) map.set(tc.toolCallId, tc)
  }
  for (const tc of fromStream) {
    const existing = map.get(tc.toolCallId)
    if (existing) {
      // Merge: prefer stream data which has output
      if (tc.output) existing.output = tc.output
      if (tc.args && !existing.args) existing.args = tc.args
      existing.status = tc.status
    } else {
      map.set(tc.toolCallId, tc)
    }
  }
  return Array.from(map.values())
}
