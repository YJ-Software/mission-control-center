import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from '@/store/websocket'

export interface ModelInfo {
  id: string
  name: string
  provider: string
}

export function useModelsList() {
  const { sendRpc, connected } = useWebSocket()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sendRpc('models.list') as any
      const rawModels = Array.isArray(result?.models)
        ? result.models
        : Array.isArray(result) ? result : []
      setModels(rawModels.map((m: any) => ({
        id: m.id || m.model || '',
        name: m.name || m.id || m.model || '',
        provider: m.provider || m.providerId || '',
      })))
    } catch (err) {
      console.error('[models.list] error:', err)
    } finally {
      setLoading(false)
    }
  }, [sendRpc])

  useEffect(() => {
    if (connected) refresh()
  }, [connected, refresh])

  return { models, loading, refresh }
}
