'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface ScheduleWindow {
  days: Day[]
  start: string
  end: string
}

export interface GateConfig {
  schedule: { timezone: string; windows: ScheduleWindow[] }
  replyText: string
  channels: string[]
  pauseAi: boolean
}

export interface GateStatus {
  installed: boolean
  enabled: boolean
  pluginSourceDir: string
  config: GateConfig
}

export type Busy = 'install' | 'uninstall' | 'save' | 'pause' | null

export interface BusinessHoursContextValue {
  data: GateStatus | undefined
  isLoading: boolean
  draft: GateConfig | null
  setDraft: (next: GateConfig) => void
  dirty: boolean
  busy: Busy
  message: { type: 'success' | 'error'; text: string } | null
  output: string
  callAction: (action: string, extra?: Record<string, unknown>) => Promise<void>
  togglePauseAi: (nextActive?: boolean) => Promise<void>
}

const Ctx = createContext<BusinessHoursContextValue | null>(null)

export function BusinessHoursProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('customerService')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<GateStatus>({
    queryKey: ['customer-service-status'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service')
      if (!res.ok) throw new Error('fetch status failed')
      return res.json()
    },
    refetchInterval: 15000,
  })

  const [draft, setDraft] = useState<GateConfig | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [output, setOutput] = useState<string>('')

  useEffect(() => {
    if (data?.config && draft === null) {
      setDraft(data.config)
    }
  }, [data, draft])

  const dirty = useMemo(() => {
    if (!data?.config || !draft) return false
    return JSON.stringify(data.config) !== JSON.stringify(draft)
  }, [data, draft])

  async function callAction(action: string, extra: Record<string, unknown> = {}) {
    const tag: Busy =
      action === 'install'
        ? 'install'
        : action === 'uninstall'
          ? 'uninstall'
          : action === 'pause-toggle'
            ? 'pause'
            : 'save'
    setBusy(tag)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      const messageKey = `messages.${action}Success`
      setMessage({
        type: 'success',
        text: t.has(messageKey) ? t(messageKey) : t('messages.saveSuccess'),
      })
      if (typeof json?.output === 'string') setOutput(json.output)
      queryClient.invalidateQueries({ queryKey: ['customer-service-status'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.genericError') })
    } finally {
      setBusy(null)
    }
  }

  async function togglePauseAi(nextActive?: boolean) {
    if (!draft) return
    const newPause = typeof nextActive === 'boolean' ? !nextActive : !draft.pauseAi
    const next = { ...draft, pauseAi: newPause }
    setDraft(next)
    setBusy('pause')
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-and-restart', config: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t('messages.pauseToggleApplied') })
      if (typeof json?.output === 'string') setOutput(json.output)
      queryClient.invalidateQueries({ queryKey: ['customer-service-status'] })
    } catch (err: any) {
      setDraft(draft)
      setMessage({ type: 'error', text: err?.message ?? t('messages.genericError') })
    } finally {
      setBusy(null)
    }
  }

  const value: BusinessHoursContextValue = {
    data,
    isLoading,
    draft,
    setDraft,
    dirty,
    busy,
    message,
    output,
    callAction,
    togglePauseAi,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBusinessHours(): BusinessHoursContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBusinessHours must be used inside BusinessHoursProvider')
  return ctx
}
