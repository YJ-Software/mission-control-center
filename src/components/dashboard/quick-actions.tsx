'use client'

import { useState, useCallback } from 'react'
import { Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ActionDef {
  id: string
  emoji: string
  labelKey: string
  loadingKey: string
  danger?: boolean
  confirm?: string
}

const actionDefs: ActionDef[] = [
  { id: 'restart-openclaw', emoji: '🔄', labelKey: 'restartOpenclaw', loadingKey: 'restarting', danger: true, confirm: 'confirmRestartOpenclaw' },
  { id: 'restart-dashboard', emoji: '🔄', labelKey: 'restartDashboard', loadingKey: 'restarting', confirm: 'confirmRestartDashboard' },
  { id: 'clear-cache', emoji: '🗑️', labelKey: 'clearCache', loadingKey: 'clearing' },
  { id: 'update-openclaw', emoji: '⬆️', labelKey: 'updateOpenclaw', loadingKey: 'updating', danger: true },
  { id: 'restart-tailscale', emoji: '🌐', labelKey: 'restartTailscale', loadingKey: 'restarting', confirm: 'confirmRestartTailscale' },
  { id: 'kill-tmux', emoji: '🧹', labelKey: 'killTmux', loadingKey: 'killing', confirm: 'confirmKillTmux' },
  { id: 'gc', emoji: '♻️', labelKey: 'gitGc', loadingKey: 'runningGc' },
  { id: 'check-update', emoji: '🔍', labelKey: 'checkUpdates', loadingKey: 'checking' },
  { id: 'sys-update', emoji: '📦', labelKey: 'aptUpdate', loadingKey: 'updating', danger: true, confirm: 'confirmSysUpdate' },
  { id: 'disk-cleanup', emoji: '💾', labelKey: 'diskCleanup', loadingKey: 'cleaning' },
  { id: 'restart-claude', emoji: '🤖', labelKey: 'restartClaude', loadingKey: 'restarting' },
  { id: 'scrape-usage', emoji: '📊', labelKey: 'usageScrape', loadingKey: 'scraping' },
]

export function QuickActions() {
  const t = useTranslations('quickActions')
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'warning') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const handleAction = useCallback(async (action: ActionDef) => {
    if (action.confirm) {
      const msg = t(action.confirm)
      if (!window.confirm(msg)) return
    }

    setLoading(prev => ({ ...prev, [action.id]: true }))

    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.id }),
      })
      const data = await res.json()

      if (data.success) {
        showToast(data.output || data.message || t('actionSuccess'), 'success')
        if (action.id === 'restart-dashboard') {
          setTimeout(() => location.reload(), 3000)
        }
      } else {
        showToast(t('actionFailed') + ': ' + (data.error || 'Unknown error'), 'warning')
      }
    } catch (e) {
      showToast(t('actionFailed') + ': ' + (e instanceof Error ? e.message : String(e)), 'warning')
    } finally {
      setLoading(prev => ({ ...prev, [action.id]: false }))
    }
  }, [t, showToast])

  return (
    <div className="cyber-card animate-slide-in delay-300">
      <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
        <Zap className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-semibold text-white/80">{t('title')}</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2.5">
          {actionDefs.map(action => {
            const isLoading = loading[action.id]
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={isLoading}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 border cursor-pointer
                  ${isLoading ? 'opacity-50 pointer-events-none' : 'hover:-translate-y-0.5'}
                  ${action.danger
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-transparent hover:shadow-[0_4px_16px_rgba(99,102,241,0.3)]'
                    : 'bg-white/[0.04] text-white/80 border-white/[0.08] hover:border-indigo-400/50'
                  }`}
              >
                {isLoading
                  ? `⏳ ${t(action.loadingKey)}`
                  : `${action.emoji} ${t(action.labelKey)}`
                }
              </button>
            )
          })}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in
          ${toast.type === 'success'
            ? 'bg-green-500/90 text-white'
            : 'bg-yellow-500/90 text-black'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span className="max-w-xs truncate">{toast.message}</span>
        </div>
      )}
    </div>
  )
}
