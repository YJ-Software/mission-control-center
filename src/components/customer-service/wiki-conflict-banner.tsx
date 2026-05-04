'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Lightbulb, Sparkles, Type, Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface WikiStatus {
  installed: boolean
  vaultMode: 'isolated' | 'bridge' | 'unsafe-local' | 'unknown'
  wikiSearchType: 'text' | 'semantic' | 'unknown'
  embeddingBackendAvailable: boolean
  conflict: 'none' | 'isolated-no-embedding' | 'embedding-not-bound'
}

export function WikiConflictBanner() {
  const t = useTranslations('customerService')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<WikiStatus>({
    queryKey: ['cs-wiki-status'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/wiki-status')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const [busy, setBusy] = useState<'isolated' | 'bridge' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (isLoading || !data || data.conflict === 'none') return null

  async function switchMode(mode: 'isolated' | 'bridge') {
    setBusy(mode)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service/wiki-status/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t(`wikiConflict.modeSwitch.${mode}Success`) })
      qc.invalidateQueries({ queryKey: ['cs-wiki-status'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? 'failed' })
    } finally {
      setBusy(null)
    }
  }

  const isSemantic = data.wikiSearchType === 'semantic'
  const targetMode: 'isolated' | 'bridge' = data.vaultMode === 'isolated' ? 'bridge' : 'isolated'

  return (
    <div className="cyber-card p-4 border border-cyan-500/25 bg-cyan-500/[0.04]">
      <div className="flex items-start gap-3">
        <Lightbulb className="w-5 h-5 text-cyan-300 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-cyan-100">
            {t(`wikiConflict.${data.conflict}.title`)}
          </h4>
          <p className="text-xs text-white/70 mt-1 leading-relaxed">
            {t(`wikiConflict.${data.conflict}.description`)}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-white/50">
            <span className="inline-flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] px-2 py-1 rounded">
              <span className="text-white/40">{t('wikiConflict.currentMode')}:</span>
              <span className="text-white/80 font-medium">{data.vaultMode}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] px-2 py-1 rounded">
              <span className="text-white/40">{t('wikiConflict.searchType')}:</span>
              {isSemantic ? (
                <span className="text-cyan-300 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> {t('wikiConflict.searchSemantic')}
                </span>
              ) : (
                <span className="text-white/70 inline-flex items-center gap-1">
                  <Type className="w-3 h-3" /> {t('wikiConflict.searchText')}
                </span>
              )}
            </span>
            {data.embeddingBackendAvailable && !isSemantic && (
              <span className="inline-flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] px-2 py-1 rounded">
                <span className="text-white/40">{t('wikiConflict.embeddingBackend')}:</span>
                <span className="text-white/70">{t('wikiConflict.embeddingReady')}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => switchMode(targetMode)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30
                disabled:opacity-50 transition-colors"
            >
              {busy === targetMode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t(`wikiConflict.modeSwitch.${targetMode}`)}
            </button>
            <span className="text-[11px] text-white/40">{t('wikiConflict.modeSwitch.restartHint')}</span>
          </div>

          {message && (
            <div
              className={`flex items-center gap-2 text-xs px-3 py-1.5 mt-3 rounded border ${
                message.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-300 border-red-500/20'
              }`}
            >
              {message.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
