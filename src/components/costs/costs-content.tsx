'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

interface CostData {
  total: number
  today: number
  week: number
  perModel: Record<string, number>
  perDay: Record<string, number>
  perSession: Record<string, { cost: number; label: string }>
}

function MetricCard({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="cyber-card p-5 text-center">
      <div className={`font-mono text-2xl font-bold ${accent ? 'text-indigo-400' : 'text-white/80'}`}>
        {value}
      </div>
      <div className="text-xs text-white/40 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function SpendTrendChart({ perDay }: { perDay: Record<string, number> }) {
  const t = useTranslations('costs')
  const days = Object.keys(perDay).sort().slice(-14)
  if (days.length === 0) return <div className="flex items-center justify-center h-60 text-white/25 font-mono text-xs">{t('noData')}</div>

  const vals = days.map(d => perDay[d] || 0)
  const maxVal = Math.max(...vals, 0.01)
  const w = 800, h = 200, pad = 40

  const points = vals.map((v, i) => {
    const x = pad + (i / Math.max(vals.length - 1, 1)) * (w - pad * 2)
    const y = h - pad - (v / maxVal) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')

  const areaPoints = `${pad},${h - pad} ${points} ${pad + ((vals.length - 1) / Math.max(vals.length - 1, 1)) * (w - pad * 2)},${h - pad}`

  const yTicks = [0, maxVal / 2, maxVal].map((val, i) => {
    const y = h - pad - (i / 2) * (h - pad * 2)
    return (
      <g key={i}>
        <text x={pad - 10} y={y + 4} fill="rgba(255,255,255,0.25)" fontSize="11" textAnchor="end" fontFamily="monospace">${val.toFixed(2)}</text>
        <line x1={pad - 5} y1={y} x2={w - pad} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,4" />
      </g>
    )
  })

  const xLabels = days.map((d, i) => {
    if (i % Math.ceil(days.length / 7) !== 0 && i !== days.length - 1) return null
    const x = pad + (i / Math.max(vals.length - 1, 1)) * (w - pad * 2)
    const date = new Date(d + 'T00:00:00')
    const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
    return <text key={d} x={x} y={h - 10} fill="rgba(255,255,255,0.25)" fontSize="11" textAnchor="middle" fontFamily="monospace">{label}</text>
  })

  const dots = vals.map((v, i) => {
    const x = pad + (i / Math.max(vals.length - 1, 1)) * (w - pad * 2)
    const y = h - pad - (v / maxVal) * (h - pad * 2)
    const date = new Date(days[i] + 'T00:00:00')
    const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
    return (
      <circle key={i} cx={x} cy={y} r="4" fill="#818cf8" stroke="rgba(255,255,255,0.04)" strokeWidth="2" className="cursor-pointer hover:r-6 transition-all">
        <title>{label}: ${v.toFixed(2)}</title>
      </circle>
    )
  })

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="max-w-full h-auto">
      {yTicks}
      <polygon points={areaPoints} fill="url(#spendGradient)" opacity="0.15" />
      <defs>
        <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {dots}
      {xLabels}
    </svg>
  )
}

export function CostsContent() {
  const t = useTranslations('costs')

  const { data } = useQuery<CostData>({
    queryKey: ['costs'],
    queryFn: () => fetch('/api/costs').then(r => r.json()),
    refetchInterval: 60000,
  })

  const perDay = data?.perDay || {}
  const dayCount = Object.keys(perDay).length || 1

  const modelEntries = Object.entries(data?.perModel || {}).sort((a, b) => b[1] - a[1])
  const sessionEntries = Object.entries(data?.perSession || {})
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)

  return (
    <div className="p-6 space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard value={`$${(data?.today ?? 0).toFixed(2)}`} label={t('today')} accent />
        <MetricCard value={`$${(data?.week ?? 0).toFixed(2)}`} label={t('thisWeek')} accent />
        <MetricCard value={`$${(data?.total ?? 0).toFixed(2)}`} label={t('allTime')} accent />
        <MetricCard value={`$${((data?.total ?? 0) / dayCount).toFixed(2)}`} label={t('avgPerDay')} />
      </div>

      {/* Spend trend chart */}
      <div className="cyber-card animate-slide-in">
        <div className="p-4 border-b border-white/[0.06]">
          <span className="text-sm font-semibold text-white/80">{t('spendTrend')}</span>
        </div>
        <div className="p-4" style={{ minHeight: 240 }}>
          <SpendTrendChart perDay={perDay} />
        </div>
      </div>

      {/* Cost by Model + Top Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Cost by Model */}
        <div className="cyber-card animate-slide-in delay-100">
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-white/80">{t('costByModel')}</span>
          </div>
          <div className="p-3">
            {modelEntries.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-white/25 font-mono text-xs">{t('noData')}</div>
            ) : (
              modelEntries.map(([model, cost]) => {
                const shortModel = model.split('/').pop() || model
                return (
                  <div key={model} className="flex items-center justify-between px-2 py-3 border-b border-white/[0.06] last:border-0">
                    <span className="font-mono text-xs text-white/60">{shortModel}</span>
                    <span className="font-mono text-xs font-bold text-indigo-400">${cost.toFixed(2)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Top Sessions */}
        <div className="cyber-card animate-slide-in delay-200">
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-white/80">{t('topSessions')}</span>
          </div>
          <div className="p-3">
            {sessionEntries.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-white/25 font-mono text-xs">{t('noData')}</div>
            ) : (
              sessionEntries.map(([sid, { cost, label }]) => (
                <div key={sid} className="flex items-center justify-between px-2 py-3 border-b border-white/[0.06] last:border-0">
                  <span className="text-xs text-white/60 truncate max-w-[200px]">{label}</span>
                  <span className="font-mono text-xs font-bold text-indigo-400">${cost.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
