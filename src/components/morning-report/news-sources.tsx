'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Rss, Plus, Trash2, RefreshCw, FlaskConical, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
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

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Rss className="w-4 h-4 text-cyan-400/70" />
          <h3 className="text-sm font-medium text-white/80">{t('sources.addTitle')}</h3>
        </div>
        <p className="text-xs text-white/40 leading-relaxed">{t('sources.addHint')}</p>

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
    </div>
  )
}
