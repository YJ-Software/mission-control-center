'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Bell, X, Trash2, AlertCircle, AlertTriangle, Info, CheckCheck } from 'lucide-react'

interface NotificationRow {
  id: string
  type: string
  severity: 'info' | 'warning' | 'error' | string
  title: string
  body: string | null
  link: string | null
  dedupKey: string | null
  createdAt: number | null
  readAt: number | null
}

interface ListResponse {
  items: NotificationRow[]
  unreadCount: number
}

interface ToastItem {
  id: string
  severity: string
  title: string
  body: string | null
  link: string | null
  hideAt: number
}

function fmtAgo(unixSec: number | null): string {
  if (!unixSec) return ''
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function severityIcon(s: string) {
  if (s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-400" />
  if (s === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
  return <Info className="w-3.5 h-3.5 text-cyan-400" />
}

function severityBorder(s: string) {
  if (s === 'error') return 'border-red-500/30 bg-red-500/[0.06]'
  if (s === 'warning') return 'border-amber-500/30 bg-amber-500/[0.06]'
  return 'border-cyan-500/30 bg-cyan-500/[0.06]'
}

export function NotificationCenter() {
  const t = useTranslations('notifications')
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery<ListResponse>({
    queryKey: ['notifications'],
    queryFn: () => fetch('/api/notifications').then(r => r.json()),
    refetchInterval: 30000,
  })

  const items = data?.items ?? []
  const unread = data?.unreadCount ?? 0

  // Live updates from /ws — re-fetch the list and surface a toast for new ones.
  useEffect(() => {
    const onNew = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; severity: string; title: string; body: string | null; link: string | null }
      qc.invalidateQueries({ queryKey: ['notifications'] })
      setToasts(prev => {
        // Dedup by id to avoid double-toast from re-renders
        if (prev.some(t => t.id === detail.id)) return prev
        return [...prev, { ...detail, hideAt: Date.now() + 5000 }]
      })
    }
    const onCleared = () => qc.invalidateQueries({ queryKey: ['notifications'] })
    window.addEventListener('notification:new', onNew)
    window.addEventListener('notification:cleared', onCleared)
    return () => {
      window.removeEventListener('notification:new', onNew)
      window.removeEventListener('notification:cleared', onCleared)
    }
  }, [qc])

  // Toast auto-dismiss
  useEffect(() => {
    if (toasts.length === 0) return
    const id = setInterval(() => {
      const now = Date.now()
      setToasts(prev => prev.filter(t => t.hideAt > now))
    }, 500)
    return () => clearInterval(id)
  }, [toasts.length])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const readMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}?action=read`, { method: 'POST' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readAllMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/notifications?action=read-all', { method: 'POST' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/notifications', { method: 'DELETE' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <>
      {/* Bell + badge */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className="relative p-2.5 sm:p-1.5 text-white/35 hover:text-white/70 transition-colors rounded-lg hover:bg-white/[0.05]"
          style={{ minWidth: 'var(--touch-min, 44px)', minHeight: 'var(--touch-min, 44px)' }}
          title={t('title')}
        >
          <Bell className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-[360px] max-h-[480px] flex flex-col rounded-xl border border-white/[0.1] bg-[#0a0a1a] shadow-2xl z-50">
            <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white/85">{t('title')}</span>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={() => readAllMutation.mutate()}
                    className="text-[10px] px-2 py-1 rounded hover:bg-white/[0.05] text-white/50 hover:text-white/80 flex items-center gap-1"
                    title={t('markAllRead')}
                  >
                    <CheckCheck className="w-3 h-3" /> {t('markAllRead')}
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    onClick={() => clearAllMutation.mutate()}
                    className="text-[10px] px-2 py-1 rounded hover:bg-white/[0.05] text-white/50 hover:text-red-400 flex items-center gap-1"
                    title={t('clearAll')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-8 text-center text-white/30 text-xs">{t('empty')}</div>
              ) : (
                items.map(n => {
                  const unread = !n.readAt
                  const Content = (
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">{severityIcon(n.severity)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white/90 truncate">{n.title}</div>
                        {n.body && <div className="text-[11px] text-white/55 mt-0.5 line-clamp-2">{n.body}</div>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-white/30 font-mono">{fmtAgo(n.createdAt)}</span>
                          <span className="text-[10px] text-white/30 font-mono">·</span>
                          <span className="text-[10px] text-white/30 font-mono">{n.type}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(n.id) }}
                        className="text-white/30 hover:text-red-400 p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                  const wrapperCls = `block px-3 py-2 border-b border-white/[0.04] cursor-pointer ${unread ? 'bg-white/[0.02]' : 'opacity-60'} hover:bg-white/[0.04]`
                  return n.link ? (
                    <a key={n.id} href={n.link} target="_blank" rel="noreferrer"
                       className={wrapperCls}
                       onClick={() => readMutation.mutate(n.id)}>{Content}</a>
                  ) : (
                    <div key={n.id} className={wrapperCls} onClick={() => readMutation.mutate(n.id)}>{Content}</div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toasts (corner, ephemeral) */}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-[360px] pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-3 py-2.5 shadow-2xl backdrop-blur ${severityBorder(toast.severity)} animate-in slide-in-from-right duration-300`}
          >
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">{severityIcon(toast.severity)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white/90">{toast.title}</div>
                {toast.body && <div className="text-[11px] text-white/55 mt-0.5">{toast.body}</div>}
                {toast.link && (
                  <a href={toast.link} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-300 hover:text-cyan-200 mt-1 inline-block">
                    {t('open')} →
                  </a>
                )}
              </div>
              <button
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="text-white/40 hover:text-white/80"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
