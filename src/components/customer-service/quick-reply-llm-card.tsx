'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Save, Loader2, CheckCircle2 } from 'lucide-react'

interface QrLlmStatus {
  count: number
  countMin: number
  countMax: number
}

export function QuickReplyLlmCard() {
  const t = useTranslations('customerService.quickReplyLlm')
  const qc = useQueryClient()

  const { data: status } = useQuery<QrLlmStatus>({
    queryKey: ['cs-quick-reply-llm'],
    queryFn: () => fetch('/api/customer-service/quick-reply-llm').then(r => r.json()),
  })

  const [count, setCount] = useState<number>(3)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!status || touched) return
    setCount(status.count)
  }, [status, touched])

  const countMin = status?.countMin ?? 1
  const countMax = status?.countMax ?? 13

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/customer-service/quick-reply-llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'save failed')
      return res.json()
    },
    onSuccess: () => {
      setTouched(false)
      qc.invalidateQueries({ queryKey: ['cs-quick-reply-llm'] })
    },
  })

  return (
    <div className="cyber-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
      </div>
      <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

      <div className="mb-4">
        <label className="block text-[11px] text-white/40 mb-1">{t('countLabel')}</label>
        <div className="flex items-center gap-2 max-w-[200px]">
          <input
            type="number"
            min={countMin}
            max={countMax}
            value={count}
            onChange={e => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) {
                setCount(Math.min(countMax, Math.max(countMin, Math.floor(v))))
                setTouched(true)
              }
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-purple-500/40"
          />
          <span className="text-xs text-white/55 font-mono">{t('countUnit')}</span>
        </div>
        <p className="text-[10px] text-white/30 mt-1">{t('countHint', { min: countMin, max: countMax })}</p>
      </div>

      <p className="text-[11px] text-white/40 leading-relaxed mb-3">{t('sharedLlmNote')}</p>

      <div className="flex items-center gap-2 pt-3 mt-3 border-t border-white/[0.04]">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!touched || saveMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 disabled:opacity-40"
        >
          {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
            saveMutation.isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {t('save')}
        </button>
      </div>
    </div>
  )
}
