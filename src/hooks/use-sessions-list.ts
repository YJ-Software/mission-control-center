import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from '@/store/websocket'

export interface ChatSession {
  sessionKey: string
  agentId?: string
  agentName?: string
  displayName?: string
  lastActivity?: number
  kind?: 'direct' | 'group' | 'global' | 'unknown'
  label?: string
  model?: string
}

function extractAgentId(key: string): string | undefined {
  const match = key.match(/^agent:([^:]+):/)
  return match?.[1]
}

export function useSessionsList() {
  const { sendRpc, connected } = useWebSocket()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // Match official UI: no activeMinutes filter, fetch all sessions
      const result = await sendRpc('sessions.list', {
        includeDerivedTitles: true,
      }) as any

      if (!result) return // WS not ready yet

      const rawSessions: any[] = Array.isArray(result?.sessions)
        ? result.sessions
        : Array.isArray(result) ? result : []

      const mapped = rawSessions.map((s: any) => {
        const key = s.key || s.sessionKey || ''
        const agentId = s.agentId || extractAgentId(key)
        return {
          sessionKey: key,
          agentId,
          agentName: s.agentName || agentId,
          displayName: s.displayName || s.derivedTitle || undefined,
          lastActivity: s.updatedAt || s.lastActivity,
          kind: s.kind,
          label: s.label,
          model: s.model,
        }
      })

      setSessions(mapped)
    } catch (err) {
      console.error('[sessions.list] error:', err)
    } finally {
      setLoading(false)
    }
  }, [sendRpc])

  useEffect(() => {
    if (connected) {
      refresh()
    }
  }, [connected, refresh])

  return { sessions, loading, refresh }
}
