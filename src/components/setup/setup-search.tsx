'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ExternalLink, Key, Save, CheckCircle2, XCircle,
  Globe, Loader2,
} from 'lucide-react'

interface SearchConfig {
  tavilyApiKey: string
  tavilyEnabled: boolean
  searchProvider: string
  searchEnabled: boolean
  fetchEnabled: boolean
  hasApiKey: boolean
}

export function SetupSearch() {
  const t = useTranslations('setup.search')
  const queryClient = useQueryClient()

  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: config, isLoading } = useQuery<SearchConfig>({
    queryKey: ['setup-search'],
    queryFn: async () => {
      const res = await fetch('/api/setup/search')
      if (!res.ok) throw new Error('Failed to fetch search config')
      return res.json()
    },
  })

  async function handleSave() {
    if (!apiKey.trim()) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/setup/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      if (!res.ok) throw new Error('Save failed')
      setMessage({ type: 'success', text: t('saveSuccess') })
      setApiKey('')
      queryClient.invalidateQueries({ queryKey: ['setup-search'] })
    } catch {
      setMessage({ type: 'error', text: t('saveError') })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/50 text-sm p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Description card */}
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-white/80 leading-relaxed">{t('description')}</p>
            <p className="text-sm text-white/50 leading-relaxed">{t('tavilyInfo')}</p>
          </div>
        </div>
      </div>

      {/* Current status */}
      {config && (
        <div className="cyber-card p-4">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
            {t('currentStatus')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatusBadge
              label="Tavily API Key"
              ok={config.hasApiKey}
              value={config.hasApiKey ? config.tavilyApiKey : t('notConfigured')}
            />
            <StatusBadge
              label={t('searchProvider')}
              ok={config.searchEnabled}
              value={config.searchProvider || '-'}
            />
            <StatusBadge
              label={t('webFetch')}
              ok={config.fetchEnabled}
              value={config.fetchEnabled ? t('configured') : t('notConfigured')}
            />
          </div>
        </div>
      )}

      {/* Step 1 */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500/15 text-cyan-400 text-xs font-bold">1</span>
          <h3 className="text-sm font-semibold text-white/90">{t('step1')}</h3>
        </div>
        <p className="text-sm text-white/50 mb-4 ml-10">{t('step1Desc')}</p>
        <div className="ml-10">
          <a
            href="https://www.tavily.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20
              transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('visitTavily')}
          </a>
        </div>
      </div>

      {/* Step 2 */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500/15 text-cyan-400 text-xs font-bold">2</span>
          <h3 className="text-sm font-semibold text-white/90">{t('step2')}</h3>
        </div>
        <p className="text-sm text-white/50 mb-4 ml-10">{t('step2Desc')}</p>
        <div className="ml-10">
          <label className="block text-xs text-white/40 mb-1.5">{t('apiKeyLabel')}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={t('apiKeyPlaceholder')}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08]
                  text-sm text-white/90 font-mono placeholder:text-white/20
                  focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20
                  transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Step 3 */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500/15 text-cyan-400 text-xs font-bold">3</span>
          <h3 className="text-sm font-semibold text-white/90">{t('step3')}</h3>
        </div>
        <p className="text-sm text-white/50 mb-4 ml-10">{t('step3Desc')}</p>
        <div className="ml-10 space-y-3">
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
              bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? t('saving') : t('save')}
          </button>

          {message && (
            <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0" />
              )}
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ label, ok, value }: {
  label: string
  ok: boolean
  value: string
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
      <span className="text-[11px] text-white/40 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400/60" />
        )}
        <span className={`text-xs font-mono ${ok ? 'text-white/70' : 'text-white/30'}`}>
          {value}
        </span>
      </div>
    </div>
  )
}
