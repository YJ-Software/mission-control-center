import { useState, useCallback, useEffect } from 'react'

function storageKey(sessionKey: string) {
  return `chat-pinned-${sessionKey}`
}

export function usePinnedMessages(sessionKey: string | null) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!sessionKey) { setPinnedIds(new Set()); return }
    try {
      const raw = localStorage.getItem(storageKey(sessionKey))
      if (raw) setPinnedIds(new Set(JSON.parse(raw)))
      else setPinnedIds(new Set())
    } catch {
      setPinnedIds(new Set())
    }
  }, [sessionKey])

  const save = useCallback((ids: Set<string>) => {
    if (!sessionKey) return
    localStorage.setItem(storageKey(sessionKey), JSON.stringify([...ids]))
  }, [sessionKey])

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      save(next)
      return next
    })
  }, [save])

  const isPinned = useCallback((id: string) => pinnedIds.has(id), [pinnedIds])

  const clearPins = useCallback(() => {
    setPinnedIds(new Set())
    if (sessionKey) localStorage.removeItem(storageKey(sessionKey))
  }, [sessionKey])

  return { pinnedIds, togglePin, isPinned, clearPins }
}
