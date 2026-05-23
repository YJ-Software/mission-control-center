'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Save, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'

interface StoragePayload {
  settings: {
    retentionDays: number | 'never'
    warnThresholdMb: number
  }
  stats: {
    mediaBytes: number
    mediaFiles: number
    oldestMediaTs: number | null
  }
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDate(unixSec: number | null): string {
  if (!unixSec) return '—'
  return new Date(unixSec * 1000).toLocaleString()
}

export function StorageCard() {
  const t = useTranslations('customerService.storage')
  const qc = useQueryClient()

  const { data } = useQuery<StoragePayload>({
    queryKey: ['cs-storage'],
    queryFn: () => fetch('/api/customer-service/storage').then(r => r.json()),
    refetchInterval: 30000,
  })

  const [retention, setRetention] = useState<string>('never')
  const [threshold, setThreshold] = useState<string>('1024')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!data) return
    if (!touched) {
      setRetention(String(data.settings.retentionDays))
      setThreshold(String(data.settings.warnThresholdMb))
    }
  }, [data, touched])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        retentionDays: retention === 'never' ? 'never' : Number(retention),
        warnThresholdMb: Number(threshold) || 1024,
      }
      const res = await fetch('/api/customer-service/storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'save failed')
      return res.json()
    },
    onSuccess: () => {
      setTouched(false)
      qc.invalidateQueries({ queryKey: ['cs-storage'] })
    },
  })

  const sweepMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/customer-service/storage?action=sweep', { method: 'POST' })
      if (!res.ok) throw new Error('sweep failed')
      return res.json() as Promise<{ tombstoned: number; unlinked: number; bytesFreed: number }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cs-storage'] }),
  })

  const mb = data ? data.stats.mediaBytes / 1024 / 1024 : 0
  const overThreshold = data ? mb >= data.settings.warnThresholdMb : false

  return (
    <div className="cyber-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <HardDrive className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
      </div>
      <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

      {/* current usage */}
      <div className={`mb-4 px-3 py-2.5 rounded-lg border ${overThreshold ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            <div className="text-white/85 flex items-center gap-2">
              {overThreshold && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
              <span className="font-mono text-sm">{fmtBytes(data?.stats.mediaBytes ?? 0)}</span>
              <span className="text-white/40">·</span>
              <span className="text-white/55">{data?.stats.mediaFiles ?? 0} {t('files')}</span>
            </div>
            <div className="text-[11px] text-white/40 font-mono mt-1">
              {t('oldest')}: {fmtDate(data?.stats.oldestMediaTs ?? null)}
            </div>
          </div>
          <button
            onClick={() => sweepMutation.mutate()}
            disabled={sweepMutation.isPending || retention === 'never'}
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.1] text-white/60 hover:bg-white/[0.08] disabled:opacity-40 flex items-center gap-1"
            title={t('sweepNow')}
          >
            {sweepMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {t('sweepNow')}
          </button>
        </div>
        {sweepMutation.isSuccess && sweepMutation.data && (
          <div className="text-[10px] text-emerald-300/80 mt-1.5 font-mono">
            {t('sweepResult', {
              tombstoned: sweepMutation.data.tombstoned,
              unlinked: sweepMutation.data.unlinked,
              freed: fmtBytes(sweepMutation.data.bytesFreed),
            })}
          </div>
        )}
      </div>

      {/* settings */}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-white/40 mb-1">{t('retentionLabel')}</label>
          <select
            value={retention}
            onChange={e => { setRetention(e.target.value); setTouched(true) }}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-amber-500/40"
          >
            <option value="30" className="bg-gray-900">{t('days', { n: 30 })}</option>
            <option value="90" className="bg-gray-900">{t('days', { n: 90 })}</option>
            <option value="180" className="bg-gray-900">{t('days', { n: 180 })}</option>
            <option value="365" className="bg-gray-900">{t('days', { n: 365 })}</option>
            <option value="never" className="bg-gray-900">{t('never')}</option>
          </select>
          <p className="text-[10px] text-white/30 mt-1 leading-relaxed">{t('retentionHelp')}</p>
        </div>

        <div>
          <label className="block text-[11px] text-white/40 mb-1">{t('thresholdLabel')}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="100"
              step="100"
              value={threshold}
              onChange={e => { setThreshold(e.target.value); setTouched(true) }}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-amber-500/40"
            />
            <span className="text-xs text-white/55 font-mono">MB</span>
          </div>
          <p className="text-[10px] text-white/30 mt-1">{t('thresholdHelp')}</p>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!touched || saveMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 disabled:opacity-40"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              saveMutation.isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
