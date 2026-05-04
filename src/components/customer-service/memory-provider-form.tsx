'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Eye,
  EyeOff,
  Loader2,
  Save,
  PlayCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

type ProviderMode = 'openai' | 'gemini' | 'ollama'

interface ProviderConfig {
  mode: ProviderMode
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxTokens: number
}

interface ProviderStatus {
  registered: boolean
  config: ProviderConfig
  hasApiKey: boolean
}

interface TestResult {
  ok: boolean
  latencyMs: number
  error?: string
}

const MODE_DEFAULTS: Record<ProviderMode, { model: string; baseUrl: string }> = {
  openai: { model: 'gemini-2.5-flash-lite', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  gemini: { model: 'gemini-2.5-flash-lite', baseUrl: '' },
  ollama: { model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434' },
}

export function MemoryProviderForm() {
  const t = useTranslations('customerService.memory.provider')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<ProviderStatus>({
    queryKey: ['cs-mem0-provider'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/memory/provider')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const [draft, setDraft] = useState<ProviderConfig | null>(null)
  const [keyVisible, setKeyVisible] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (data?.config && draft === null) setDraft(data.config)
  }, [data, draft])

  const dirty = useMemo(() => {
    if (!data?.config || !draft) return false
    return JSON.stringify(data.config) !== JSON.stringify(draft)
  }, [data, draft])

  function changeMode(mode: ProviderMode) {
    if (!draft) return
    const def = MODE_DEFAULTS[mode]
    setDraft({ ...draft, mode, model: def.model, baseUrl: def.baseUrl })
  }

  async function save(restart: boolean) {
    if (!draft) return
    setBusy('save')
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service/memory/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: restart ? 'save-and-restart' : 'save', config: draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: restart ? t('messages.savedAndRestart') : t('messages.saved') })
      qc.invalidateQueries({ queryKey: ['cs-mem0-provider'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.failed') })
    } finally {
      setBusy(null)
    }
  }

  async function runTest() {
    setBusy('test')
    setTestResult(null)
    try {
      const res = await fetch('/api/customer-service/memory/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const json = (await res.json()) as TestResult
      setTestResult(json)
    } catch (err: any) {
      setTestResult({ ok: false, latencyMs: 0, error: err?.message ?? 'failed' })
    } finally {
      setBusy(null)
    }
  }

  if (isLoading || !draft) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
      </div>
    )
  }

  if (!data?.registered) {
    return (
      <div className="cyber-card p-5 text-sm text-white/60">
        {t('notRegistered')}
      </div>
    )
  }

  const apiKeyMasked = data.config.apiKey

  return (
    <div className="space-y-4">
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-1">{t('title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed mb-5">{t('description')}</p>

        {/* Mode selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
          {(['openai', 'gemini', 'ollama'] as ProviderMode[]).map((mode) => {
            const active = draft.mode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => changeMode(mode)}
                className={`text-left rounded-lg border px-3 py-3 transition-colors ${
                  active
                    ? 'border-cyan-500/30 bg-cyan-500/[0.08]'
                    : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className={`text-xs uppercase tracking-wider ${active ? 'text-cyan-300' : 'text-white/40'}`}>
                  {t(`modes.${mode}.tag`)}
                </div>
                <div className="text-sm font-semibold mt-1 text-white/90">{t(`modes.${mode}.name`)}</div>
                <div className="text-[11px] text-white/50 mt-1 leading-snug">{t(`modes.${mode}.desc`)}</div>
              </button>
            )
          })}
        </div>

        {/* Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs text-white/60 mb-1">{t('fields.model')}</label>
            <input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
            />
          </div>

          {(draft.mode === 'openai' || draft.mode === 'ollama') && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/60 mb-1">{t('fields.baseUrl')}</label>
              <input
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
              />
            </div>
          )}

          {draft.mode !== 'ollama' && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/60 mb-1">{t('fields.apiKey')}</label>
              <div className="relative">
                <input
                  type={keyVisible ? 'text' : 'password'}
                  placeholder={apiKeyMasked || t('fields.apiKeyPlaceholder')}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-white/40 hover:text-white/80"
                >
                  {keyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[11px] text-white/40 mt-1">{t('fields.apiKeyHint')}</p>
            </div>
          )}

          <div>
            <label className="block text-xs text-white/60 mb-1">{t('fields.temperature')}</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => setDraft({ ...draft, temperature: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">{t('fields.maxTokens')}</label>
            <input
              type="number"
              min={1}
              max={32000}
              value={draft.maxTokens}
              onChange={(e) => setDraft({ ...draft, maxTokens: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5">
          <button
            onClick={() => save(true)}
            disabled={busy !== null || !dirty}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
              disabled:opacity-50 transition-colors"
          >
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('actions.saveAndRestart')}
          </button>
          <button
            onClick={runTest}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.08]
              disabled:opacity-50"
          >
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {t('actions.test')}
          </button>
          {dirty && <span className="text-xs text-amber-300">{t('messages.unsaved')}</span>}

          {testResult && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              {testResult.ok
                ? `${t('messages.testOk')} · ${testResult.latencyMs} ms`
                : testResult.error}
            </span>
          )}
        </div>

        {message && (
          <div
            className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
              message.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}
          >
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}
