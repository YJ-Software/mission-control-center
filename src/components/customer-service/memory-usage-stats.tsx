'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

interface DayBucket {
  date: string
  add: number
  search: number
  list: number
  fail: number
  avgLatencyMs: number
}

interface StatsResponse {
  totalsLast7d: { add: number; search: number; list: number; fail: number }
  totalsLast30d: { add: number; search: number; list: number; fail: number }
  uniqueUsers7d: number
  avgLatencyMs7d: { add: number; search: number; list: number }
  buckets: DayBucket[]
  recent: Array<{ ts: string; action: 'add' | 'search' | 'list'; user_id: string; latency_ms: number; success: boolean }>
  telemetryPath: string
  telemetryAvailable: boolean
  telemetrySize: number
}

export function MemoryUsageStats() {
  const t = useTranslations('customerService.memory.stats')
  const { data, isLoading, error } = useQuery<StatsResponse>({
    queryKey: ['cs-mem0-stats'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/memory/stats')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 30000,
  })

  if (isLoading || !data) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="cyber-card p-5 text-sm text-red-300 flex items-center gap-2">
        <XCircle className="w-4 h-4" /> {String(error)}
      </div>
    )
  }

  if (!data.telemetryAvailable) {
    return (
      <div className="cyber-card p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white/90">{t('noData.title')}</h3>
            <p className="text-xs text-white/60 mt-1 leading-relaxed">
              {t('noData.description')}
            </p>
            <p className="text-[11px] text-white/40 mt-2 font-mono">{data.telemetryPath}</p>
          </div>
        </div>
      </div>
    )
  }

  const max = Math.max(
    1,
    ...data.buckets.map((b) => b.add + b.search + b.list),
  )

  const total7 = data.totalsLast7d.add + data.totalsLast7d.search + data.totalsLast7d.list

  return (
    <div className="space-y-4">
      <div className="cyber-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label={t('kpis.totalCalls7d')} value={total7.toLocaleString()} />
          <Kpi label={t('kpis.uniqueUsers7d')} value={data.uniqueUsers7d.toLocaleString()} />
          <Kpi label={t('kpis.avgSearchLatency')} value={`${data.avgLatencyMs7d.search} ms`} />
          <Kpi
            label={t('kpis.failures7d')}
            value={data.totalsLast7d.fail.toLocaleString()}
            tone={data.totalsLast7d.fail > 0 ? 'warn' : 'ok'}
          />
        </div>
      </div>

      <div className="cyber-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs uppercase tracking-wider text-white/50">{t('chart.title')}</h4>
          <Legend />
        </div>
        <div className="grid grid-cols-7 gap-2 items-end h-40">
          {data.buckets.map((b) => {
            const totalH = (b.add + b.search + b.list) / max
            const addPct = b.add / Math.max(1, b.add + b.search + b.list)
            const searchPct = b.search / Math.max(1, b.add + b.search + b.list)
            const listPct = b.list / Math.max(1, b.add + b.search + b.list)
            return (
              <div key={b.date} className="flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse h-32 rounded-md overflow-hidden bg-white/[0.02] border border-white/[0.05]" title={`${b.date}\nadd ${b.add} · search ${b.search} · list ${b.list}\navg ${b.avgLatencyMs} ms`}>
                  {totalH > 0 ? (
                    <div className="w-full" style={{ height: `${totalH * 100}%` }}>
                      <div className="w-full bg-cyan-500/40" style={{ height: `${searchPct * 100}%` }} />
                      <div className="w-full bg-emerald-500/40" style={{ height: `${addPct * 100}%` }} />
                      <div className="w-full bg-white/15" style={{ height: `${listPct * 100}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="text-[10px] text-white/40 font-mono">{b.date.slice(5)}</div>
                <div className="text-[10px] text-white/60">{b.add + b.search + b.list}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="cyber-card p-5">
        <h4 className="text-xs uppercase tracking-wider text-white/50 mb-3">{t('recent.title')}</h4>
        {data.recent.length === 0 ? (
          <div className="text-xs text-white/40">{t('recent.empty')}</div>
        ) : (
          <div className="space-y-1 text-xs">
            {data.recent.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-2 py-1.5 rounded bg-white/[0.02] border border-white/[0.05]"
              >
                {r.success ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
                <span className="font-mono text-white/40 w-32 truncate">{r.ts.replace('T', ' ').slice(0, 19)}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                    r.action === 'add'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : r.action === 'search'
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : 'bg-white/10 text-white/70'
                  }`}
                >
                  {r.action}
                </span>
                <span className="font-mono text-white/50 truncate flex-1">{r.user_id}</span>
                <span className="font-mono text-white/40 shrink-0">{r.latency_ms} ms</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div>
      <div
        className={`text-xl font-semibold mt-1 ${
          tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-white/90'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-white/50">
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/60 rounded-sm" /> add</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-cyan-500/60 rounded-sm" /> search</span>
      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-white/30 rounded-sm" /> list</span>
    </div>
  )
}
