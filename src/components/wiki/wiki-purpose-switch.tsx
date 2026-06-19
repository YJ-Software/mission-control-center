'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Brain, Headset, Loader2, ArrowLeftRight, AlertTriangle } from 'lucide-react'

export type WikiPurpose = 'agent' | 'customer-service'

const PURPOSE_ICON = { agent: Brain, 'customer-service': Headset } as const

interface Props {
  /** Compact header variant (used atop the customer-service wiki tab). */
  compact?: boolean
  onSwitchedAction?: (purpose: WikiPurpose) => void
}

export function WikiPurposeSwitch({ compact = false, onSwitchedAction }: Props) {
  const t = useTranslations('wikiPurpose')
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<WikiPurpose | null>(null)

  const purposeQuery = useQuery<{ purpose: WikiPurpose }>({
    queryKey: ['wiki-purpose'],
    queryFn: () => fetch('/api/second-brain/wiki?type=purpose').then(r => r.json()),
  })

  const switchMutation = useMutation({
    mutationFn: async (purpose: WikiPurpose) => {
      const r = await fetch('/api/second-brain/wiki?action=purpose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose }),
      })
      const data = await r.json()
      if (!r.ok || data.ok === false) throw new Error(data.error || 'switch failed')
      return purpose
    },
    onSuccess: (purpose) => {
      setConfirming(null)
      // Everything that reads purpose/config should re-fetch.
      queryClient.invalidateQueries({ queryKey: ['wiki-purpose'] })
      queryClient.invalidateQueries({ queryKey: ['wiki-detect'] })
      queryClient.invalidateQueries({ queryKey: ['cs-wiki-entries'] })
      onSwitchedAction?.(purpose)
    },
  })

  const current = purposeQuery.data?.purpose
  const other: WikiPurpose = current === 'agent' ? 'customer-service' : 'agent'
  const CurrentIcon = current ? PURPOSE_ICON[current] : Brain

  if (!current) {
    return <div className="h-9 flex items-center"><Loader2 className="w-4 h-4 animate-spin text-white/30" /></div>
  }

  return (
    <div className={compact ? 'flex items-center gap-3 flex-wrap' : 'rounded-xl border border-white/[0.08] bg-white/[0.03] p-4'}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/40">{t('currentLabel')}</span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-cyan-200 bg-cyan-500/10 border border-cyan-400/20">
          <CurrentIcon className="w-3.5 h-3.5" />
          {t(current === 'agent' ? 'agent' : 'customerService')}
        </span>
      </div>

      {!compact && (
        <p className="text-xs text-white/45 mt-2 mb-3 leading-relaxed">
          {t(current === 'agent' ? 'agentDesc' : 'customerServiceDesc')}
        </p>
      )}

      {confirming === other ? (
        <div className={compact ? 'flex items-center gap-2 flex-wrap' : 'rounded-lg border border-amber-400/20 bg-amber-500/[0.06] p-3'}>
          {!compact && (
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/90 leading-relaxed">{t('confirmBody', { target: t(other === 'agent' ? 'agent' : 'customerService') })}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => switchMutation.mutate(other)}
              disabled={switchMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-100 bg-amber-500/20 border border-amber-400/30 hover:bg-amber-500/25 disabled:opacity-50"
            >
              {switchMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />}
              {switchMutation.isPending ? t('switching') : t('confirm')}
            </button>
            <button
              onClick={() => setConfirming(null)}
              disabled={switchMutation.isPending}
              className="px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white/90 disabled:opacity-50"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(other)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:text-white/90"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          {t('switchTo', { target: t(other === 'agent' ? 'agent' : 'customerService') })}
        </button>
      )}

      {switchMutation.isError && (
        <p className="text-xs text-red-400 mt-2 w-full">{(switchMutation.error as Error).message}</p>
      )}
      {!compact && (
        <p className="text-[11px] text-white/30 mt-2">{t('restartNote')}</p>
      )}
    </div>
  )
}
