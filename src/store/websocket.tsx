'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

interface ActivityEvent {
  id: string
  kind: string
  agentId?: string
  message: string
  status: 'active' | 'pending' | 'error' | 'idle'
  timestamp: Date
}

export interface ChatEventPayload {
  runId: string
  sessionKey: string
  seq: number
  state: 'delta' | 'final' | 'error' | 'aborted'
  message?: {
    role: 'assistant' | 'user'
    content: Array<{ type: string; text: string; name?: string; input?: unknown; id?: string }>
    timestamp: number
  }
  errorMessage?: string
}

export interface ToolStreamPayload {
  stream: 'tool'
  runId?: string
  sessionKey?: string
  ts?: number
  data: {
    toolCallId: string
    name: string
    phase: 'start' | 'update' | 'result'
    args?: unknown
    result?: unknown
    partialResult?: unknown
  }
}

type ChatListener = (payload: ChatEventPayload) => void
type ToolStreamListener = (payload: ToolStreamPayload) => void

interface PendingRpc {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface WebSocketContextValue {
  connected: boolean
  events: ActivityEvent[]
  sendMessage: (msg: object) => void
  agentStatuses: Record<string, string>
  sendRpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  addChatListener: (callback: ChatListener) => () => void
  addToolStreamListener: (callback: ToolStreamListener) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  events: [],
  sendMessage: () => {},
  agentStatuses: {},
  sendRpc: () => Promise.reject(new Error('WebSocket not connected')),
  addChatListener: () => () => {},
  addToolStreamListener: () => () => {},
})

export function useWebSocket() {
  return useContext(WebSocketContext)
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common')
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rpcIdRef = useRef(0)
  const pendingRpcsRef = useRef<Map<string, PendingRpc>>(new Map())
  const chatListenersRef = useRef<Set<ChatListener>>(new Set())
  const toolStreamListenersRef = useRef<Set<ToolStreamListener>>(new Set())

  const addEvent = useCallback((event: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const newEvent: ActivityEvent = {
      ...event,
      id: Math.random().toString(36).substring(2),
      timestamp: new Date(),
    }
    setEvents(prev => [newEvent, ...prev].slice(0, 100))
  }, [])

  const connect = useCallback(() => {
    try {
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProto}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        // Server handles auth with gateway, just send a hello
        ws.send(JSON.stringify({ type: 'client-connect' }))
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          handleMessage(msg)
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        // Reject all pending RPCs on disconnect
        for (const [, pending] of pendingRpcsRef.current) {
          clearTimeout(pending.timer)
          pending.reject(new Error('WebSocket disconnected'))
        }
        pendingRpcsRef.current.clear()
        // Reconnect after 3s
        reconnectTimerRef.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {}
  }, [])

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    // Customer Service bus events (forwarded from the cs-store EventEmitter
    // by server.ts). Re-emit as a window CustomEvent so the Conversations
    // tab can subscribe without coupling to this store.
    if (typeof msg.type === 'string' && msg.type.startsWith('cs:')) {
      try {
        window.dispatchEvent(new CustomEvent(msg.type, { detail: msg.payload }))
      } catch { /* ignore */ }
      return
    }

    // Handle RPC responses
    if (msg.type === 'res') {
      const id = String(msg.id)
      const pending = pendingRpcsRef.current.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        pendingRpcsRef.current.delete(id)
        if (msg.ok) {
          pending.resolve(msg.payload)
        } else {
          const errMsg = typeof msg.error === 'string'
            ? msg.error
            : typeof msg.error === 'object' && msg.error !== null
              ? (msg.error as Record<string, unknown>).message as string || JSON.stringify(msg.error)
              : 'RPC error'
          pending.reject(new Error(errMsg))
        }
      }
      return
    }

    // Handle chat events
    if (msg.type === 'event' && msg.event === 'chat') {
      const payload = msg.payload as Record<string, unknown>
      if (payload) {
        // Tool stream events have payload.stream === 'tool'
        if (payload.stream === 'tool') {
          const toolPayload: ToolStreamPayload = {
            stream: 'tool',
            runId: payload.runId as string | undefined,
            sessionKey: payload.sessionKey as string | undefined,
            ts: payload.ts as number | undefined,
            data: payload.data as ToolStreamPayload['data'],
          }
          for (const listener of toolStreamListenersRef.current) {
            try { listener(toolPayload) } catch {}
          }
        } else {
          // Regular chat event (delta/final/error/aborted)
          for (const listener of chatListenersRef.current) {
            try { listener(payload as unknown as ChatEventPayload) } catch {}
          }
        }
      }
      return
    }

    // Existing message handling
    const kind = msg.kind as string || msg.type as string

    if (kind === 'agent' || kind === 'chat') {
      const agentId = msg.agentId as string
      const status = (msg.status as string) || 'active'
      if (agentId) {
        setAgentStatuses(prev => ({ ...prev, [agentId]: status }))
      }
      addEvent({
        kind,
        agentId: agentId,
        message: (msg.content as string) || (msg.message as string) || `Agent ${agentId} event: ${kind}`,
        status: status === 'ok' ? 'active' : status === 'error' ? 'error' : 'pending',
      })
    } else if (kind === 'tick' || kind === 'heartbeat') {
      // silent
    } else if (kind === 'hello-ok') {
      addEvent({
        kind: 'system',
        message: t('connectedToGateway'),
        status: 'active',
      })
    }
  }, [addEvent, t])

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const sendRpc = useCallback((method: string, params?: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        // Silently resolve with null when not connected — callers check `connected` state
        return resolve(null)
      }
      const id = `rpc-${++rpcIdRef.current}-${Date.now().toString(36)}`
      const timer = setTimeout(() => {
        pendingRpcsRef.current.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 30_000)
      pendingRpcsRef.current.set(id, { resolve, reject, timer })
      wsRef.current!.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }, [])

  const addChatListener = useCallback((callback: ChatListener): (() => void) => {
    chatListenersRef.current.add(callback)
    return () => {
      chatListenersRef.current.delete(callback)
    }
  }, [])

  const addToolStreamListener = useCallback((callback: ToolStreamListener): (() => void) => {
    toolStreamListenersRef.current.add(callback)
    return () => {
      toolStreamListenersRef.current.delete(callback)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      // Clean up pending RPCs
      for (const [, pending] of pendingRpcsRef.current) {
        clearTimeout(pending.timer)
        pending.reject(new Error('WebSocket provider unmounted'))
      }
      pendingRpcsRef.current.clear()
      wsRef.current?.close()
    }
  }, [connect])

  return (
    <WebSocketContext.Provider value={{ connected, events, sendMessage, agentStatuses, sendRpc, addChatListener, addToolStreamListener }}>
      {children}
    </WebSocketContext.Provider>
  )
}
