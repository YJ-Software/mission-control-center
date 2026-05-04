'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Mail,
  AlertTriangle,
} from 'lucide-react'

interface HandoffConfig {
  telegram: { botToken: string; chatId: string }
  email: { apiKey: string; inboxId: string; to: string }
}

interface HandoffStatus {
  installed: boolean
  config: HandoffConfig
  telegramReady: boolean
  emailReady: boolean
}

const EMPTY: HandoffConfig = {
  telegram: { botToken: '', chatId: '' },
  email: { apiKey: '', inboxId: '', to: '' },
}

export function HandoffTab() {
  const t = useTranslations('customerService.handoff')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<HandoffStatus>({
    queryKey: ['customer-service-handoff'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/handoff')
      if (!res.ok) throw new Error('fetch handoff failed')
      return res.json()
    },
  })

  const [draft, setDraft] = useState<HandoffConfig | null>(null)
  const [busy, setBusy] = useState(false)
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

  async function save() {
    if (!draft) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-and-restart', config: draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t('messages.saveSuccess') })
      if (typeof json?.output === 'string') setOutput(json.output)
      queryClient.invalidateQueries({ queryKey: ['customer-service-handoff'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.genericError') })
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center p-12 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (!data?.installed) {
    return (
      <div className="cyber-card p-5 border-amber-500/30 bg-amber-500/[0.04] flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-amber-200">{t('notInstalled.title')}</h3>
          <p className="text-xs text-white/60 mt-1 leading-relaxed">{t('notInstalled.description')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-2">{t('title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed">{t('description')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <StatusBadge label={t('status.telegram')} ok={data.telegramReady} />
          <StatusBadge label={t('status.email')} ok={data.emailReady} />
        </div>
      </div>

      {/* Telegram */}
      <div className="cyber-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('telegram.title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('telegram.description')}</p>

        <Field
          label={t('telegram.botToken')}
          hint={t('telegram.botTokenHint')}
          type="password"
          value={draft.telegram.botToken}
          onChange={(v) => setDraft({ ...draft, telegram: { ...draft.telegram, botToken: v } })}
          placeholder="123456:ABC-DEF..."
        />
        <Field
          label={t('telegram.chatId')}
          hint={t('telegram.chatIdHint')}
          value={draft.telegram.chatId}
          onChange={(v) => setDraft({ ...draft, telegram: { ...draft.telegram, chatId: v } })}
          placeholder="1005601933"
        />
      </div>

      {/* AgentMail */}
      <div className="cyber-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('email.title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('email.description')}</p>

        <Field
          label={t('email.apiKey')}
          hint={t('email.apiKeyHint')}
          type="password"
          value={draft.email.apiKey}
          onChange={(v) => setDraft({ ...draft, email: { ...draft.email, apiKey: v } })}
          placeholder="am_..."
        />
        <Field
          label={t('email.inboxId')}
          hint={t('email.inboxIdHint')}
          value={draft.email.inboxId}
          onChange={(v) => setDraft({ ...draft, email: { ...draft.email, inboxId: v } })}
          placeholder="agent-name@agentmail.to"
        />
        <Field
          label={t('email.to')}
          hint={t('email.toHint')}
          type="email"
          value={draft.email.to}
          onChange={(v) => setDraft({ ...draft, email: { ...draft.email, to: v } })}
          placeholder="team@example.com"
        />
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
            disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('actions.save')}
        </button>
        {dirty && <span className="text-xs text-amber-300">{t('messages.unsaved')}</span>}
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
            message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}

      {output && (
        <pre className="max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'email'
}) {
  return (
    <div>
      <label className="block text-xs text-white/60 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
      />
      {hint && <p className="text-[11px] text-white/40 mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <span className="text-xs text-white/60">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-white/40">
          <XCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  )
}
