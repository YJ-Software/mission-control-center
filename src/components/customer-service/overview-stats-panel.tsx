'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  MessageSquare,
  Users,
  Pause,
  Inbox,
  Send,
  Paperclip,
  HardDrive,
  AlertTriangle,
  Info,
  AlertOctagon,
  Sparkles,
} from 'lucide-react'

interface Recommendation {
  id: string
  severity: 'info' | 'warning' | 'attention'
  text: string
  i18nKey?: string
  i18nValues?: Record<string, string | number>
}

interface StatsPayload {
  stats: {
    conversationsTotal: number
    conversationsActive24h: number
    conversationsActive7d: number
    pausedNow: number
    inbound24h: number
    outboundBot24h: number
    outboundOperator24h: number
    fileCount24h: number
    missingProfiles: number
    awaitingReply: { count: number; oldestAgeSec: number | null }
    pausesExpiringSoon: number
    storage: {
      bytes: number
      files: number
      thresholdMb: number
      overThreshold: boolean
      pctOfThreshold: number
      retentionDays: number | 'never'
    }
  }
  recommendations: Recommendation[]
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  accent = 'cyan',
}: {
  icon: typeof MessageSquare
  label: string
  value: number | string
  hint?: string
  accent?: 'cyan' | 'purple' | 'amber' | 'emerald' | 'red'
}) {
  const ring = {
    cyan: 'text-cyan-300',
    purple: 'text-purple-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    red: 'text-red-300',
  }[accent]
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${ring}`} />
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-mono">{label}</span>
      </div>
      <div className={`text-2xl font-semibold ${ring}`}>{value}</div>
      {hint && <div className="text-[11px] text-white/40 mt-0.5 font-mono">{hint}</div>}
    </div>
  )
}

function RecommendationRow({ rec }: { rec: Recommendation }) {
  const t = useTranslations('customerService.stats.recommendations')
  const colors = {
    info:      'border-cyan-500/25 bg-cyan-500/[0.05] text-cyan-200',
    warning:   'border-amber-500/30 bg-amber-500/[0.06] text-amber-200',
    attention: 'border-red-500/30 bg-red-500/[0.06] text-red-200',
  }[rec.severity]
  const Icon = rec.severity === 'attention' ? AlertOctagon : rec.severity === 'warning' ? AlertTriangle : Info
  const message = rec.i18nKey ? t(rec.i18nKey, rec.i18nValues as Record<string, string | number>) : rec.text
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${colors}`}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span className="text-[12px] leading-relaxed">{message}</span>
    </div>
  )
}

export function OverviewStatsPanel() {
  const t = useTranslations('customerService.stats')
  const { data, isLoading } = useQuery<StatsPayload>({
    queryKey: ['cs-stats'],
    queryFn: () => fetch('/api/customer-service/stats').then(r => r.json()),
    refetchInterval: 30000,
  })

  if (isLoading || !data) {
    return (
      <div className="cyber-card p-6 text-center text-white/40 text-sm">{t('loading')}</div>
    )
  }
  const s = data.stats

  return (
    <div className="space-y-5">
      {/* Recommendations */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('recommendationsTitle')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-3">{t('recommendationsHint')}</p>
        <div className="space-y-2">
          {data.recommendations.length === 0 ? (
            <div className="text-xs text-white/40">{t('recommendations.allGood')}</div>
          ) : (
            data.recommendations.map(rec => <RecommendationRow key={rec.id} rec={rec} />)
          )}
        </div>
      </div>

      {/* Conversation metrics */}
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-3">{t('conversationsTitle')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={Users} label={t('total')} value={s.conversationsTotal} accent="cyan" />
          <StatTile icon={MessageSquare} label={t('active24h')} value={s.conversationsActive24h} hint={t('active24hHint', { d7: s.conversationsActive7d })} accent="emerald" />
          <StatTile icon={Pause} label={t('paused')} value={s.pausedNow} hint={s.pausesExpiringSoon > 0 ? t('pausesExpiringSoon', { n: s.pausesExpiringSoon }) : ''} accent="amber" />
          <StatTile icon={AlertTriangle} label={t('awaiting')} value={s.awaitingReply.count} hint={s.awaitingReply.oldestAgeSec ? t('awaitingHint', { min: Math.floor(s.awaitingReply.oldestAgeSec / 60) }) : ''} accent={s.awaitingReply.count > 0 ? 'red' : 'cyan'} />
        </div>
      </div>

      {/* Traffic (last 24h) */}
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-3">{t('trafficTitle')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={Inbox} label={t('inbound24h')} value={s.inbound24h} accent="cyan" />
          <StatTile icon={Send} label={t('botReplies24h')} value={s.outboundBot24h} accent="emerald" />
          <StatTile icon={Send} label={t('operatorReplies24h')} value={s.outboundOperator24h} accent="purple" />
          <StatTile icon={Paperclip} label={t('files24h')} value={s.fileCount24h} accent="amber" />
        </div>
      </div>

      {/* Storage */}
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-3">{t('storageTitle')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatTile icon={HardDrive} label={t('usage')} value={fmtBytes(s.storage.bytes)} hint={t('files', { n: s.storage.files })} accent={s.storage.overThreshold ? 'red' : 'cyan'} />
          <StatTile icon={AlertTriangle} label={t('threshold')} value={`${s.storage.thresholdMb} MB`} hint={t('pctOfThreshold', { pct: Math.round(s.storage.pctOfThreshold * 100) })} accent={s.storage.pctOfThreshold >= 0.8 ? 'amber' : 'cyan'} />
          <StatTile icon={Info} label={t('retention')} value={s.storage.retentionDays === 'never' ? t('retentionNever') : `${s.storage.retentionDays} ${t('days')}`} accent={s.storage.retentionDays === 'never' ? 'amber' : 'cyan'} />
        </div>
      </div>
    </div>
  )
}
