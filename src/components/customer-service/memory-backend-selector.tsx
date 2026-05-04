'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Loader2,
  Database,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react'

type Mode = 'mem0' | 'wiki-person'

interface BackendStatus {
  agentId: string | null
  agentsMdPath: string | null
  blockPresent: boolean
  mode: Mode | 'unknown'
}

interface InjectorChip {
  installed: boolean
  enabled: boolean
}

interface GateStatus {
  idInjector?: InjectorChip
}

export function MemoryBackendSelector() {
  const t = useTranslations('customerService.memory.backend')
  const qc = useQueryClient()

  const { data: status, isLoading } = useQuery<BackendStatus>({
    queryKey: ['cs-memory-backend'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/memory/backend')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const { data: gate } = useQuery<GateStatus>({
    queryKey: ['customer-service-status'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const [busy, setBusy] = useState<Mode | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [output, setOutput] = useState('')

  async function pick(mode: Mode) {
    setBusy(mode)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service/memory/backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t(`messages.${mode}Applied`) })
      if (typeof json.output === 'string') setOutput(json.output)
      qc.invalidateQueries({ queryKey: ['cs-memory-backend'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.failed') })
    } finally {
      setBusy(null)
    }
  }

  if (isLoading || !status) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
      </div>
    )
  }

  const injector = gate?.idInjector
  const injectorOk = injector?.installed && injector?.enabled

  return (
    <div className="space-y-4">
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-1">{t('title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

        {/* Injector status badge */}
        <div
          className={`mb-4 rounded-lg border px-3 py-2.5 text-xs ${
            injectorOk
              ? 'border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/[0.04] text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {injectorOk ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="font-medium">{t('injector.label')}</span>
            <span className="text-white/60">·</span>
            <span className="text-white/70">{injectorOk ? t('injector.ok') : t('injector.missing')}</span>
          </div>
          <p className="text-[11px] text-white/50 mt-1.5 ml-6 leading-relaxed">{t('injector.explain')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModeCard
            icon={<Database className="w-4 h-4" />}
            title={t('modes.mem0.title')}
            desc={t('modes.mem0.desc')}
            bullets={t.raw('modes.mem0.bullets') as string[]}
            active={status.mode === 'mem0'}
            onPick={() => pick('mem0')}
            busy={busy === 'mem0'}
            disabled={busy !== null}
            cta={t('modes.mem0.cta')}
            activeText={t('modes.activeBadge')}
          />
          <ModeCard
            icon={<FileText className="w-4 h-4" />}
            title={t('modes.wikiPerson.title')}
            desc={t('modes.wikiPerson.desc')}
            bullets={t.raw('modes.wikiPerson.bullets') as string[]}
            active={status.mode === 'wiki-person'}
            onPick={() => pick('wiki-person')}
            busy={busy === 'wiki-person'}
            disabled={busy !== null}
            cta={t('modes.wikiPerson.cta')}
            activeText={t('modes.activeBadge')}
          />
        </div>

        <p className="text-[11px] text-white/40 mt-4 leading-relaxed">{t('switchHint')}</p>
        {status.agentsMdPath && (
          <p className="text-[10.5px] text-white/30 font-mono mt-1 break-all">{status.agentsMdPath}</p>
        )}

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
        {output && (
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap">
            {output}
          </pre>
        )}
      </div>
    </div>
  )
}

function ModeCard({
  icon,
  title,
  desc,
  bullets,
  active,
  onPick,
  busy,
  disabled,
  cta,
  activeText,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  bullets: string[]
  active: boolean
  onPick: () => void
  busy: boolean
  disabled: boolean
  cta: string
  activeText: string
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        active
          ? 'border-cyan-500/30 bg-cyan-500/[0.06]'
          : 'border-white/[0.08] bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-cyan-300">
          {icon}
          <span className="text-sm font-semibold text-white/90">{title}</span>
        </div>
        {active && (
          <span className="text-[10.5px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
            {activeText}
          </span>
        )}
      </div>
      <p className="text-xs text-white/55 leading-relaxed mb-3">{desc}</p>
      <ul className="text-[11.5px] text-white/60 space-y-1 mb-4">
        {(bullets ?? []).map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-cyan-400/60">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onPick}
        disabled={disabled || active}
        className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50
          ${active
            ? 'bg-white/[0.04] text-white/40 border border-white/[0.06] cursor-default'
            : 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30'}`}
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {active ? activeText : cta}
      </button>
    </div>
  )
}
