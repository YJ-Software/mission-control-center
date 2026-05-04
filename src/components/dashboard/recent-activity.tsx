'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Session {
  key: string
  label: string
  model: string
  totalTokens: number
  kind: string
  updatedAt: number
  createdAt: number
  aborted: boolean
  lastMessage: string
  cost: number
  agentId: string
}

function getTypeClass(session: Session): string {
  if (session.key.includes('subagent')) return 'sub'
  if (session.key.includes('cron')) return 'cron'
  if (session.kind === 'group') return 'group'
  return 'main'
}

function formatAgo(ts: number): string {
  const age = Date.now() - ts
  if (age < 60000) return 'just now'
  if (age < 3600000) return Math.round(age / 60000) + 'm ago'
  if (age < 86400000) return Math.round(age / 3600000) + 'h ago'
  return Math.round(age / 86400000) + 'd ago'
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M'
  if (tokens >= 1000) return (tokens / 1000).toFixed(0) + 'k'
  return String(tokens)
}

function formatDuration(createdAt: number): string {
  const dur = Date.now() - createdAt
  if (dur > 86400000) return Math.floor(dur / 86400000) + 'd'
  if (dur > 3600000) return Math.floor(dur / 3600000) + 'h'
  if (dur > 60000) return Math.floor(dur / 60000) + 'm'
  return ''
}

const borderColors: Record<string, string> = {
  main: 'border-l-indigo-500',
  sub: 'border-l-cyan-400',
  cron: 'border-l-yellow-400',
  group: 'border-l-blue-400',
}

const badgeStyles: Record<string, string> = {
  main: 'bg-indigo-500 text-white',
  sub: 'bg-cyan-400/20 text-cyan-400',
  cron: 'bg-yellow-400/20 text-yellow-400',
  group: 'bg-blue-400/20 text-blue-400',
}

export function RecentActivity() {
  const t = useTranslations('dashboard')
  const router = useRouter()

  const { data: sessionsData } = useQuery<{ sessions: Session[] }>({
    queryKey: ['sessions-recent'],
    queryFn: () => fetch('/api/sessions').then(r => r.json()),
    refetchInterval: 15000,
  })

  const sessions = sessionsData?.sessions || []

  // Sort by updatedAt desc, deduplicate by label, take top 8
  const seen = new Set<string>()
  const recent = sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(s => {
      if (seen.has(s.label)) return false
      seen.add(s.label)
      return true
    })
    .slice(0, 8)

  return (
    <div className="cyber-card animate-slide-in delay-200">
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white/80">{t('recentActivity')}</span>
        </div>
        <Link href="/sessions" className="font-mono text-[10px] text-cyan-400/50 tracking-widest hover:text-cyan-400 transition-colors">
          {t('viewAllSessions')}
        </Link>
      </div>
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-2xl">📭</div>
            <div className="font-mono text-[10px] text-white/25 tracking-widest">{t('noRecentActivity')}</div>
          </div>
        ) : (
          recent.map(s => {
            const type = getTypeClass(s)
            const isActive = (Date.now() - s.updatedAt) < 300000 && !s.aborted
            const tokStr = formatTokens(s.totalTokens)
            const costStr = s.cost > 0 ? '$' + s.cost.toFixed(2) : ''
            const durStr = formatDuration(s.createdAt)
            const modelShort = s.model.split('/').pop() || s.model

            return (
              <div
                key={s.key}
                onClick={() => router.push(`/sessions?session=${encodeURIComponent(s.key)}`)}
                className={`flex gap-2 px-3 py-2 rounded-lg border-l-[3px] ${borderColors[type] || 'border-l-white/20'} cursor-pointer transition-all duration-200 hover:translate-x-1 ${
                  isActive
                    ? 'bg-white/[0.04] shadow-[0_0_16px_rgba(16,185,129,0.15)] border-l-4'
                    : 'bg-gradient-to-r from-white/[0.02] to-white/[0.01] hover:from-white/[0.04] hover:to-white/[0.02]'
                }`}
              >
                {/* Status dot */}
                <div className="mt-1.5 shrink-0">
                  <span
                    className={`block w-1.5 h-1.5 rounded-full ${
                      isActive
                        ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse'
                        : 'bg-white/20'
                    }`}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Header: name + badge + time */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-semibold text-white/90 truncate">{s.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${badgeStyles[type] || 'bg-white/10 text-white/50'}`}>
                        {type}
                      </span>
                    </div>
                    <span className="text-[11px] text-white/35 shrink-0">{formatAgo(s.updatedAt)}</span>
                  </div>

                  {/* Last message snippet */}
                  {s.lastMessage && (
                    <div className="text-xs text-white/40 truncate font-mono mb-0.5">
                      {s.lastMessage}
                    </div>
                  )}

                  {/* Meta: model, tokens, cost, duration */}
                  <div className="flex items-center gap-2 text-[11px] text-white/30">
                    <span>{modelShort}</span>
                    <span>{tokStr} tok</span>
                    {costStr && <span className="text-green-400/70">{costStr}</span>}
                    {durStr && <span>⏱ {durStr}</span>}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
