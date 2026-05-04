'use client'

import { useQuery } from '@tanstack/react-query'
import { DollarSign } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface CostData {
  total: number
  today: number
  week: number
  perDay: Record<string, number>
}

export function DailySpend() {
  const t = useTranslations('dashboard')

  const { data } = useQuery<CostData>({
    queryKey: ['costs'],
    queryFn: () => fetch('/api/costs').then(r => r.json()),
    refetchInterval: 60000,
  })

  const perDay = data?.perDay || {}
  const days = Object.keys(perDay).sort().slice(-7)
  const maxSpend = Math.max(...days.map(d => perDay[d] || 0), 0.01)
  const chartHeight = 120

  return (
    <div className="cyber-card animate-slide-in delay-300">
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white/80">{t('dailySpend')}</span>
        </div>
        {data && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-mono text-[10px] text-white/30 uppercase tracking-wider">{t('today')}</div>
              <div className="font-mono text-xs text-green-400">${data.today.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] text-white/30 uppercase tracking-wider">{t('thisWeek')}</div>
              <div className="font-mono text-xs text-cyan-400">${data.week.toFixed(2)}</div>
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        {days.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-2xl">📊</div>
            <div className="font-mono text-[10px] text-white/25 tracking-widest">{t('noData')}</div>
          </div>
        ) : (
          <div className="flex items-end gap-1" style={{ height: chartHeight + 40 }}>
            {days.map(day => {
              const amount = perDay[day] || 0
              const h = Math.max(4, (amount / maxSpend) * chartHeight)
              const date = new Date(day + 'T00:00:00')
              const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
              const isToday = day === new Date().toISOString().substring(0, 10)

              return (
                <div
                  key={day}
                  className="flex-1 flex flex-col items-center justify-end group"
                >
                  {/* Value */}
                  <div className="font-mono text-[10px] text-white/30 group-hover:text-white/60 transition-colors whitespace-nowrap mb-1">
                    ${amount.toFixed(2)}
                  </div>
                  {/* Bar */}
                  <div
                    className={`w-[60%] max-w-[48px] rounded-t-md transition-all duration-300 cursor-pointer group-hover:brightness-130 ${
                      isToday
                        ? 'shadow-[0_0_16px_rgba(99,102,241,0.4)]'
                        : ''
                    }`}
                    style={{
                      height: h,
                      background: isToday
                        ? 'linear-gradient(180deg, #a5b4fc, #818cf8)'
                        : 'linear-gradient(180deg, #818cf8, #7c3aed)',
                      minHeight: 4,
                      marginBottom: 8,
                    }}
                  />
                  {/* Label */}
                  <div className={`font-mono text-[10px] ${isToday ? 'text-indigo-400' : 'text-white/25'}`}>
                    {label}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
