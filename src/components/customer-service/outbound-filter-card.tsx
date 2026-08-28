'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, Eye, EyeOff, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

type FilterMode = 'off' | 'shadow' | 'enforce'
type Outcome = 'allow' | 'rewrite' | 'block'

interface RuleMatch {
  ruleId: string
  label: string
  action: 'block' | 'strip'
  sample: string
}

interface HitRow {
  id: string
  userId: string
  channelId: string | null
  mode: string
  outcome: Outcome
  matches: RuleMatch[] | null
  originalText: string
  proposedText: string | null
  createdAt: number | null
}

interface FilterResponse {
  mode: FilterMode
  rules: Array<{ id: string; label: string; action: string; pattern: string }>
  stats: {
    total: number
    last24h: number
    byRule: Array<{ ruleId: string; label: string; count: number }>
    byOutcome: Record<Outcome, number>
  }
  hits: HitRow[]
}

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

export function OutboundFilterCard() {
  const t = useTranslations('customerService.outboundFilter')
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading } = useQuery<FilterResponse>({
    queryKey: ['cs-outbound-filter'],
    queryFn: () => fetch('/api/customer-service/outbound-filter?limit=50').then(r => r.json()),
    refetchInterval: 60_000,
  })

  const modeMutation = useMutation({
    mutationFn: async (mode: FilterMode) => {
      const res = await fetch('/api/customer-service/outbound-filter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'save failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-outbound-filter'] }),
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/customer-service/outbound-filter', { method: 'DELETE' })
      if (!res.ok) throw new Error('clear failed')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-outbound-filter'] }),
  })

  const mode = data?.mode ?? 'shadow'
  const stats = data?.stats
  const hits = data?.hits ?? []

  return (
    <div className="cyber-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
          {t(`mode.${mode}`)}
        </span>
      </div>
      <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => modeMutation.mutate(mode === 'shadow' ? 'off' : 'shadow')}
          disabled={modeMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 disabled:opacity-40"
        >
          {modeMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : mode === 'shadow' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {mode === 'shadow' ? t('turnOff') : t('turnOn')}
        </button>
        {hits.length > 0 && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-white/[0.04] text-white/60 hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('clear')}
          </button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label={t('stats.total')} value={stats.total} />
          <Stat label={t('stats.last24h')} value={stats.last24h} />
          <Stat label={t('stats.wouldBlock')} value={stats.byOutcome.block ?? 0} accent />
        </div>
      )}

      {stats && stats.byRule.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] text-white/40 mb-1.5">{t('byRule')}</div>
          <div className="flex flex-wrap gap-1.5">
            {stats.byRule.map(r => (
              <span key={r.ruleId} className="text-[11px] px-2 py-0.5 rounded border border-white/[0.08] bg-white/[0.03] text-white/60 font-mono">
                {r.ruleId} · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-white/40 mb-1.5">{t('recentHits')}</div>
      {isLoading ? (
        <div className="text-xs text-white/40">{t('loading')}</div>
      ) : hits.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-xs text-white/40">
          {mode === 'off' ? t('emptyOff') : t('empty')}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {hits.map(hit => {
            const open = expanded === hit.id
            return (
              <div key={hit.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
                <button
                  onClick={() => setExpanded(open ? null : hit.id)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                >
                  {open ? <ChevronDown className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        hit.outcome === 'block'
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      }`}>
                        {t(`outcome.${hit.outcome}`)}
                      </span>
                      {(hit.matches ?? []).map(m => (
                        <span key={m.ruleId} className="text-[10px] text-white/45 font-mono">{m.ruleId}</span>
                      ))}
                    </div>
                    <div className="text-xs text-white/70 truncate mt-1">{hit.originalText}</div>
                    <div className="text-[10px] text-white/30 mt-0.5">{timeAgo(hit.createdAt)} · {hit.channelId ?? '—'}</div>
                  </div>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.04]">
                    <Block label={t('detail.original')} text={hit.originalText} />
                    <Block
                      label={t('detail.proposed')}
                      text={hit.proposedText ?? t('detail.nothingSent')}
                      muted={hit.proposedText === null}
                    />
                    {(hit.matches ?? []).map(m => (
                      <div key={m.ruleId} className="text-[11px] text-white/50">
                        <span className="font-mono text-white/70">{m.ruleId}</span> ({m.action}) — <span className="text-white/40">{m.sample}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-white/35 leading-relaxed mt-3 pt-3 border-t border-white/[0.04]">
        {t('shadowNote')}
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className={`text-lg font-mono ${accent ? 'text-red-300' : 'text-white/90'}`}>{value}</div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  )
}

function Block({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-white/35 mb-0.5">{label}</div>
      <pre className={`text-[11px] whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1.5 ${muted ? 'text-white/30 italic' : 'text-white/65'}`}>
        {text}
      </pre>
    </div>
  )
}
