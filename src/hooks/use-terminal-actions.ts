'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTerminalStore } from '@/store/terminal'

export function useTerminalActions() {
  const t = useTranslations('terminal')
  const { addSession, removeSession, setSessions, sessions } = useTerminalStore()
  const [ready, setReady] = useState(false)

  // Rehydrate sessions from server on mount
  useEffect(() => {
    if (sessions.length > 0) { setReady(true); return } // Already have sessions
    fetch('/api/terminal')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.sessions?.length > 0) {
          setSessions(data.sessions)
          useTerminalStore.getState().setActiveSession(data.sessions[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/terminal', { method: 'POST' })
      if (res.status === 429) {
        alert(t('maxSessionsReached'))
        return
      }
      if (res.status === 503) {
        alert(t('ptyNotAvailable'))
        return
      }
      if (!res.ok) throw new Error('Failed to create session')
      const session = await res.json()
      addSession(session)
    } catch (e) {
      console.error('Failed to create terminal session:', e)
    }
  }, [addSession, t])

  const closeSession = useCallback(async (id: string) => {
    try {
      await fetch(`/api/terminal/${id}`, { method: 'DELETE' })
    } catch {}
    removeSession(id)
  }, [removeSession])

  return { createSession, closeSession, ready }
}
