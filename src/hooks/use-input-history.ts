import { useState, useCallback, useRef } from 'react'

const MAX_HISTORY = 50

export function useInputHistory() {
  const historyRef = useRef<string[]>([])
  const [index, setIndex] = useState(-1)

  const push = useCallback((text: string) => {
    const h = historyRef.current
    if (h.length > 0 && h[h.length - 1] === text) return
    h.push(text)
    if (h.length > MAX_HISTORY) h.shift()
    setIndex(-1)
  }, [])

  const navigateUp = useCallback((_currentInput: string): string | null => {
    const h = historyRef.current
    if (h.length === 0) return null
    const newIndex = index === -1 ? h.length - 1 : Math.max(0, index - 1)
    setIndex(newIndex)
    return h[newIndex] ?? null
  }, [index])

  const navigateDown = useCallback((): string | null => {
    const h = historyRef.current
    if (index === -1) return null
    const newIndex = index + 1
    if (newIndex >= h.length) {
      setIndex(-1)
      return ''
    }
    setIndex(newIndex)
    return h[newIndex] ?? null
  }, [index])

  const reset = useCallback(() => setIndex(-1), [])

  return { push, navigateUp, navigateDown, reset }
}
