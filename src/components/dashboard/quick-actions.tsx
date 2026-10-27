'use client'

import { useState, useCallback, useRef } from 'react'
import { Zap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { NODE_BLOCK_MESSAGE_KEY, isNodePreflightBlockDetails, nodeBlockMessageValues } from '@/lib/openclaw/node-preflight-message'
import { MEMORY_BLOCK_MESSAGE_KEY, isMemoryPreflightBlockDetails, memoryBlockMessageValues } from '@/lib/openclaw/memory-preflight-message'
import { useLongRunGuard } from '@/hooks/use-long-run-guard'

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
  { id: 'update-mcc', emoji: '⬆️', labelKey: 'updateMcc', loadingKey: 'updating', danger: true, confirm: 'confirmUpdateMcc' },
  { id: 'restart-tailscale', emoji: '🌐', labelKey: 'restartTailscale', loadingKey: 'restarting', confirm: 'confirmRestartTailscale' },
  { id: 'check-update', emoji: '🔍', labelKey: 'checkUpdates', loadingKey: 'checking' },
  { id: 'sys-update', emoji: '📦', labelKey: 'aptUpdate', loadingKey: 'updating', danger: true, confirm: 'confirmSysUpdate' },
]

export function QuickActions() {
  const t = useTranslations('quickActions')
  const tn = useTranslations('openclawNodePreflight')
  const tm = useTranslations('openclawMemoryPreflight')
  const guard = useLongRunGuard()
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'warning') => {
    setToast({ message, type })
    // 警告（例如重啟被長時間安裝作業擋下）要讀得完，停留久一點
    setTimeout(() => setToast(null), type === 'warning' ? 10000 : 4000)
  }, [])

  const handleAction = useCallback(async (action: ActionDef, force = false) => {
    // force 重送時使用者已在長時間作業對話框確認過兩次，不再問一次
    if (action.confirm && !force) {
      const msg = t(action.confirm)
      if (!window.confirm(msg)) return
    }

    setLoading(prev => ({ ...prev, [action.id]: true }))

    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.id, ...(force ? { force: true } : {}) }),
      })
      const data = await res.json()

      if (data.success) {
        if (data.warning) showToast(data.warning, 'warning')
        else showToast(data.output || data.message || t('actionSuccess'), 'success')
        if (action.id === 'restart-dashboard') {
          setTimeout(() => location.reload(), 3000)
        }
      } else if (data.code === 'memory-insufficient') {
        // 停掉 gateway 後記憶體仍可能不夠：講清楚風險（主機可能失去回應），使用者確認後才帶 force 重送
        const details: unknown = data.preflight
        const msg = isMemoryPreflightBlockDetails(details)
          ? tm(MEMORY_BLOCK_MESSAGE_KEY, memoryBlockMessageValues(details))
          : (data.error ?? '')
        if (window.confirm(`${msg}\n\n${tm('confirmTryAnyway')}`)) void handleActionRef.current(action, true)
      } else if (data.code === 'node-unsupported') {
        // Node 版本不符合新版 OpenClaw：使用者看過訊息仍要試才帶 force 重送（OpenClaw 自己還會再檢查）
        const details: unknown = data.preflight
        const msg = isNodePreflightBlockDetails(details)
          ? tn(NODE_BLOCK_MESSAGE_KEY[details.reason], nodeBlockMessageValues(details))
          : (data.error ?? '')
        if (window.confirm(`${msg}\n\n${tn('confirmTryAnyway')}`)) void handleActionRef.current(action, true)
      } else if (!guard.handle(data, () => { void handleActionRef.current(action, true) })) {
        showToast(t('actionFailed') + ': ' + (data.error || 'Unknown error'), 'warning')
      }
    } catch (e) {
      showToast(t('actionFailed') + ': ' + (e instanceof Error ? e.message : String(e)), 'warning')
    } finally {
      setLoading(prev => ({ ...prev, [action.id]: false }))
    }
  }, [t, tn, tm, showToast, guard.handle])
  const handleActionRef = useRef(handleAction)
  handleActionRef.current = handleAction

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

      {guard.dialog}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in
          ${toast.type === 'success'
            ? 'bg-green-500/90 text-white'
            : 'bg-yellow-500/90 text-black'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span className={toast.type === 'warning' ? 'max-w-sm break-words' : 'max-w-xs truncate'}>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
