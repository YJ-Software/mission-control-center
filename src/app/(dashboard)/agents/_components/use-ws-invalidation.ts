'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from '@/store/websocket'

export function useAgentsWsInvalidation(agentId: string | null) {
  const qc = useQueryClient()
  const { events } = useWebSocket()

  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    const kind = latest.kind ?? ''
    if (kind.startsWith('agent')) {
      qc.invalidateQueries({ queryKey: ['agents'] })
    } else if (kind.startsWith('skill')) {
      qc.invalidateQueries({ queryKey: ['agents', 'skills', agentId] })
    } else if (kind.startsWith('cron')) {
      qc.invalidateQueries({ queryKey: ['agents', 'cron', 'list', agentId] })
      qc.invalidateQueries({ queryKey: ['agents', 'cron', 'status'] })
    } else if (kind.startsWith('channel')) {
      qc.invalidateQueries({ queryKey: ['agents', 'channels', agentId] })
    }
  }, [events, qc, agentId])
}
