'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Cpu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SystemStats, HealthSnapshot } from '@/lib/system-stats'

type SystemStatsWithHistory = SystemStats & { history?: HealthSnapshot[] }

const CIRCUMFERENCE = 2 * Math.PI * 52

// Smoothly animate a number from previous to target value
function useAnimatedNumber(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target)
  const prev = useRef(target)
  const raf = useRef<number>(0)

  useEffect(() => {
    const from = prev.current
    const delta = target - from
    if (delta === 0) return
    const start = performance.now()

    const step = (now: number) => {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + delta * ease))
      if (t < 1) {
        raf.current = requestAnimationFrame(step)
      } else {
        prev.current = target
      }
    }

    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, duration])

  return display
}

function getGaugeColor(percent: number): string {
  if (percent < 50) return 'text-emerald-400'
  if (percent < 80) return 'text-yellow-400'
  return 'text-red-400'
}

function getGaugeStroke(percent: number): string {
  if (percent < 50) return 'stroke-emerald-400'
  if (percent < 80) return 'stroke-yellow-400'
  return 'stroke-red-400'
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const w = 100
  const h = 24
  const min = Math.max(Math.min(...data) - 5, 0)
  const max = Math.min(Math.max(...data) + 5, 100)
  const range = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-1">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  )
}

const SPARKLINE_COLORS: Record<string, string> = {
  cpu: '#34d399',
  ram: '#34d399',
  temp: '#facc15',
  load: '#facc15',
  disk: '#c084fc',
}

function RadialGauge({
  percent,
  label,
  value,
  detail,
  fixedColor,
  sparkData,
  sparkKey,
}: {
  percent: number
  label: string
  value: string
  detail?: string
  fixedColor?: string
  sparkData?: number[]
  sparkKey?: string
}) {
  const animPct = useAnimatedNumber(percent)
  const offset = CIRCUMFERENCE - (animPct / 100) * CIRCUMFERENCE
  const strokeClass = fixedColor || getGaugeStroke(animPct)
  const textClass = fixedColor?.replace('stroke-', 'text-') || getGaugeColor(animPct)

  return (
    <div className="flex flex-col items-center gap-0">
      <div className="relative w-[100px] h-[100px]">
        <svg viewBox="0 0 120 120" className="-rotate-90 w-full h-full">
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            className="stroke-white/[0.06]"
            strokeWidth="8"
          />
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            className={strokeClass}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-mono text-xl font-bold ${textClass}`}>{value}</span>
          <span className="font-mono text-[10px] text-white/40 uppercase tracking-widest">{label}</span>
        </div>
      </div>
      {sparkData && sparkData.length >= 2 && (
        <Sparkline data={sparkData} color={sparkKey ? SPARKLINE_COLORS[sparkKey] || '#34d399' : '#34d399'} />
      )}
      {detail && (
        <span className="font-mono text-[9px] text-white/25 tracking-wide mt-0.5">{detail}</span>
      )}
    </div>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function SystemHealth() {
  const t = useTranslations('dashboard')

  const { data: stats } = useQuery<SystemStatsWithHistory>({
    queryKey: ['system-stats'],
    queryFn: () => fetch('/api/system').then(r => r.json()),
    refetchInterval: 8000,
  })

  if (!stats) {
    return (
      <div className="cyber-card animate-slide-in">
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white/80">{t('systemHealth')}</span>
        </div>
        <div className="p-6 flex items-center justify-center">
          <span className="font-mono text-[10px] text-white/20 tracking-widest">LOADING...</span>
        </div>
      </div>
    )
  }

  const cpuPct = stats.cpu?.usage ?? 0
  const ramPct = stats.memory?.percent ?? 0
  const temp = stats.cpu?.temp
  const tempPct = temp != null ? Math.min((temp / 90) * 100, 100) : 0
  const diskPct = stats.disk?.percent ?? 0

  // On VPS where temp sensors aren't exposed, fall back to load-average saturation.
  const hasTemp = temp != null
  const load1m = parseFloat(stats.loadAvg?.['1m'] ?? '0')

  const history = stats.history ?? []
  const cpuHistory = history.map(h => h.cpu)
  const ramHistory = history.map(h => h.ram)
  const tempHistory = history.map(h => h.temp)
  const loadHistory = history.map(h => h.load ?? 0)
  const diskHistory = history.map(h => h.disk)
  const loadPct = loadHistory.length > 0 ? loadHistory[loadHistory.length - 1] : 0

  return (
    <div className="cyber-card animate-slide-in">
      <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
        <Cpu className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-white/80">{t('systemHealth')}</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
          <RadialGauge
            percent={cpuPct}
            label="CPU"
            value={`${cpuPct}%`}
            sparkData={cpuHistory}
            sparkKey="cpu"
          />

          <RadialGauge
            percent={ramPct}
            label="RAM"
            value={`${ramPct}%`}
            detail={stats.memory ? `${stats.memory.usedGB} / ${stats.memory.totalGB} GB` : undefined}
            sparkData={ramHistory}
            sparkKey="ram"
          />

          {hasTemp ? (
            <RadialGauge
              percent={tempPct}
              label="TEMP"
              value={`${temp!.toFixed(0)}°`}
              fixedColor="stroke-yellow-400"
              sparkData={tempHistory}
              sparkKey="temp"
            />
          ) : (
            <RadialGauge
              percent={loadPct}
              label="LOAD"
              value={load1m.toFixed(2)}
              detail={stats.loadAvg ? `${stats.loadAvg['5m']} / ${stats.loadAvg['15m']}` : undefined}
              fixedColor="stroke-yellow-400"
              sparkData={loadHistory}
              sparkKey="load"
            />
          )}

          <RadialGauge
            percent={diskPct}
            label="DISK"
            value={`${diskPct}%`}
            detail={stats.disk ? `${stats.disk.used} / ${stats.disk.total}` : undefined}
            fixedColor="stroke-purple-400"
            sparkData={diskHistory}
            sparkKey="disk"
          />

          {/* UPTIME */}
          <div className="flex flex-col items-center justify-center gap-1 pt-2">
            <span className="font-mono text-xl font-bold text-cyan-400">
              {formatUptime(stats.uptime ?? 0)}
            </span>
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-widest">UPTIME</span>
            {hasTemp && stats.loadAvg && (
              <span className="font-mono text-[9px] text-white/25 tracking-wide">
                Load: {stats.loadAvg['1m']} {stats.loadAvg['5m']} {stats.loadAvg['15m']}
              </span>
            )}
          </div>

          {/* CRASHES */}
          <div className="flex flex-col items-center justify-center gap-1 pt-2">
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-widest mb-1">Crashes</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-mono text-xl font-bold ${(stats.crashesToday ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {stats.crashesToday ?? 0}
              </span>
              <span className="font-mono text-[9px] text-white/30 uppercase">today</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`font-mono text-sm font-semibold ${(stats.crashCount ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {stats.crashCount ?? 0}
              </span>
              <span className="font-mono text-[9px] text-white/30 uppercase">7-day</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
