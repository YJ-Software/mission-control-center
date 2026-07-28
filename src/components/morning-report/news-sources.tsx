'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Rss, Plus, Trash2, RefreshCw, FlaskConical, Loader2, CheckCircle2, AlertTriangle, BookOpen, ChevronDown, ShieldAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FEED_PRESETS, PRESET_GROUPS } from '@/lib/morning-report/feed-presets'
import { Button } from '@/components/ui/button'

interface FeedRow {
  id: string
  label: string
  urlMasked: string
  enabled: number
  lastFetchedAt: number | null
  lastStatus: string | null
  lastError: string | null
  lastItemCount: number | null
}

interface PreviewResult {
  total: number
  items: { title: string; url: string; host: string; publishedAt: number | null }[]
  error?: string
}

const API = '/api/morning-report'

/**
 * Native <option> and <optgroup> don't reliably take CSS classes — several
 * browsers render them with the OS default palette regardless — so a dark UI
 * has to set their colours inline. Skipping the optgroup is what turned the
 * group headings into blank white bars.
 */
const OPTION_STYLE = { backgroundColor: '#0a0a1a', color: 'rgba(255,255,255,0.8)' } as const
const OPTGROUP_STYLE = { backgroundColor: '#0a0a1a', color: 'rgba(255,255,255,0.45)' } as const

function relTime(unix: number | null, never: string): string {
  if (!unix) return never
  const mins = Math.round((Date.now() / 1000 - unix) / 60)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

export function NewsSources() {
  const t = useTranslations('morningReport')
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  const { data, isLoading } = useQuery<{ feeds: FeedRow[] }>({
    queryKey: ['news-feeds'],
    queryFn: () => fetch(`${API}?type=feeds`).then(r => r.json()),
    refetchInterval: 60_000,
  })
  const feeds = data?.feeds ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['news-feeds'] })

  const previewMutation = useMutation({
    mutationFn: async (): Promise<PreviewResult> => {
      const res = await fetch(`${API}?action=preview-feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      return body
    },
    onSuccess: setPreview,
    onError: (e: Error) => setPreview({ total: 0, items: [], error: e.message }),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}?action=create-feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, url }),
      }).then(r => r.json()),
    onSuccess: () => { setLabel(''); setUrl(''); setPreview(null); invalidate() },
  })

  const toggleMutation = useMutation({
    mutationFn: (f: FeedRow) =>
      fetch(`${API}?type=feed`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: f.id, enabled: f.enabled !== 1 }),
      }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`${API}?type=feed&id=${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const fetchMutation = useMutation({
    mutationFn: (id?: string) =>
      fetch(`${API}?action=fetch-feeds${id ? `&id=${id}` : ''}`, { method: 'POST' }).then(r => r.json()),
    onSuccess: invalidate,
  })

  const steps = t.raw('sources.guide.steps') as { t: string; d: string }[]

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Rss className="w-4 h-4 text-cyan-400/70" />
          <h3 className="text-sm font-medium text-white/80">{t('sources.addTitle')}</h3>
        </div>
        <p className="text-xs text-white/40 leading-relaxed">{t('sources.addHint')}</p>

        {/* Preset picker. Every entry was verified against this project's own
            parser; the fields stay editable so a preset is a starting point,
            not a commitment. */}
        <select
          value=""
          onChange={e => {
            const p = FEED_PRESETS.find(x => x.url === e.target.value)
            if (!p) return
            setLabel(p.label)
            setUrl(p.url)
            setPreview(null)
          }}
          className="w-full bg-white/[0.03] border border-white/[0.08] text-xs text-white/70
            rounded-md px-3 py-2 outline-none focus:border-cyan-400/50"
        >
          <option value="" style={OPTION_STYLE}>
            {t('sources.presetPick')}
          </option>
          {PRESET_GROUPS.map(g => {
            const items = FEED_PRESETS.filter(p => p.group === g)
            if (items.length === 0) return null
            return (
              <optgroup key={g} label={t(`sources.presetGroups.${g}`)} style={OPTGROUP_STYLE}>
                {items.map(p => {
                  // Already registered — offering it again would just create a
                  // duplicate that fetches the same articles twice.
                  const added = feeds.some(f => f.label === p.label)
                  return (
                    <option
                      key={p.url}
                      value={p.url}
                      disabled={added}
                      style={OPTION_STYLE}
                    >
                      {added ? `✓ ${p.label}` : p.label}
                    </option>
                  )
                })}
              </optgroup>
            )
          })}
        </select>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={t('sources.labelPlaceholder')}
            className="sm:w-52 bg-white/[0.03] border-white/[0.08] text-sm"
          />
          <Input
            value={url}
            onChange={e => { setUrl(e.target.value); setPreview(null) }}
            placeholder="https://www.google.com/alerts/feeds/…"
            className="flex-1 bg-white/[0.03] border-white/[0.08] text-sm font-mono"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!url.trim() || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FlaskConical className="w-3.5 h-3.5" />}
              {t('sources.test')}
            </Button>
            <Button
              size="sm"
              disabled={!url.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('sources.add')}
            </Button>
          </div>
        </div>

        {preview && (
          <div className="rounded border border-white/[0.08] bg-black/20 p-3 text-xs space-y-1.5">
            {preview.error ? (
              <div className="flex items-start gap-2 text-rose-300/90">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{preview.error}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-emerald-300/90">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('sources.testOk', { count: preview.total })}
                </div>
                {preview.items.map(item => (
                  <div key={item.url} className="text-white/50 truncate">
                    <span className="text-white/30 font-mono mr-1.5">{item.host}</span>
                    {item.title}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/80">
            {t('sources.listTitle', { count: feeds.length })}
          </h3>
          <Button
            variant="outline"
            size="sm"
            disabled={feeds.length === 0 || fetchMutation.isPending}
            onClick={() => fetchMutation.mutate(undefined)}
          >
            {fetchMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            {t('sources.fetchAll')}
          </Button>
        </div>

        {isLoading && <p className="text-xs text-white/30">{t('sources.loading')}</p>}
        {!isLoading && feeds.length === 0 && (
          <p className="text-xs text-white/30">{t('sources.empty')}</p>
        )}

        {feeds.map(feed => (
          <div
            key={feed.id}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 flex items-center gap-3"
          >
            <button
              type="button"
              onClick={() => toggleMutation.mutate(feed)}
              title={feed.enabled === 1 ? t('sources.disable') : t('sources.enable')}
              className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                feed.enabled === 1 ? 'bg-emerald-400' : 'bg-white/20'
              }`}
            />

            <div className="min-w-0 flex-1">
              <div className="text-sm text-white/80 truncate">{feed.label}</div>
              {/* Masked: the full address is a credential. */}
              <div className="text-[10px] font-mono text-white/25 truncate">{feed.urlMasked}</div>
            </div>

            <div className="text-[10px] text-right shrink-0">
              {feed.lastStatus === 'error' ? (
                <span className="text-rose-300/80" title={feed.lastError ?? ''}>
                  {t('sources.statusError')}
                </span>
              ) : (
                <span className="text-white/40">
                  {t('sources.statusOk', { count: feed.lastItemCount ?? 0 })}
                </span>
              )}
              <div className="text-white/25">
                {relTime(feed.lastFetchedAt, t('sources.never'))}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => fetchMutation.mutate(feed.id)}
                disabled={fetchMutation.isPending}
                title={t('sources.fetchOne')}
                className="p-1.5 rounded text-white/40 hover:text-cyan-400 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(feed.id)}
                title={t('sources.delete')}
                className="p-1.5 rounded text-white/40 hover:text-rose-400 hover:bg-white/[0.06] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {/* Where a feed address comes from. Collapsed by default and placed
          last: it is reference material, needed once per source and never
          again, so it should not sit between the operator and the list. */}
      <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(o => !o)}
          className="w-full flex items-center gap-2.5 p-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-amber-300" />
          </div>
          <h3 className="text-sm font-medium text-white flex-1">{t('sources.guide.title')}</h3>
          <span className="text-[11px] text-white/40">
            {guideOpen ? t('sources.guide.hide') : t('sources.guide.show')}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-white/40 transition-transform ${guideOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {guideOpen && (
          <div className="px-4 pb-4 space-y-4">
            <p className="text-[13px] text-white/60 leading-relaxed">{t('sources.guide.intro')}</p>

            <ol className="space-y-2.5">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-5 h-5 rounded-md bg-amber-500/15 text-amber-300 text-[11px] font-mono flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white/85">{s.t}</div>
                    <p className="text-[13px] text-white/55 leading-relaxed break-words">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[13px] font-medium text-white/80 mb-1">
                {t('sources.guide.otherTitle')}
              </div>
              <p className="text-[13px] text-white/55 leading-relaxed">{t('sources.guide.otherBody')}</p>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-rose-400/20 bg-rose-500/[0.06] p-3">
              <ShieldAlert className="w-4 h-4 text-rose-300/90 shrink-0 mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-rose-200/90 mb-1">
                  {t('sources.guide.securityTitle')}
                </div>
                <p className="text-[13px] text-white/60 leading-relaxed">
                  {t('sources.guide.securityBody')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
