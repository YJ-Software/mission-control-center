'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Clock, Play, Loader2 } from 'lucide-react'
import { useState, useCallback } from 'react'
import type { CronJobInfo } from '@/lib/morning-report/cron-cli'

function formatNextRun(nextRunAtMs: number | undefined, enabled: boolean): string {
  if (!enabled) return 'disabled'
  if (!nextRunAtMs) return '--'
  const now = Date.now()
  const diff = nextRunAtMs - now
  if (diff <= 0) return 'now'
  if (diff < 60000) return 'in <1m'
  if (diff < 3600000) return `in ${Math.round(diff / 60000)}m`
  if (diff < 86400000) return `in ${Math.round(diff / 3600000)}h`
  return `in ${Math.round(diff / 86400000)}d`
}

function formatLastDuration(ms: number | undefined): string {
  if (!ms) return '--'
  return `${(ms / 1000).toFixed(0)}s`
}

function formatSchedule(job: CronJobInfo): string {
  if (job.scheduleKind === 'at' && job.scheduleAt) {
    const d = new Date(job.scheduleAt)
    return d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  if (job.scheduleKind === 'every' && job.scheduleEveryMs) {
    const mins = Math.round(job.scheduleEveryMs / 60000)
    if (mins < 60) return `every ${mins}m`
    return `every ${Math.round(mins / 60)}h`
  }
  if (job.schedule) {
    try {
      const parts = job.schedule.split(' ')
      if (parts.length === 5) {
        const [min, hour] = parts
        const tz = job.timezone?.split('/').pop() || ''
        if (hour !== '*' && min !== '*') {
          const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
          return tz ? `${time} (${tz})` : time
        }
      }
    } catch { /* fallback */ }
    return job.schedule
  }
  return ''
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'ok') return <span className="text-emerald-400 text-xs">&#x2714;</span>
  if (status === 'error' || status === 'fail') return <span className="text-red-400 text-xs">&#x2718;</span>
  return <span className="text-white/20 text-xs">&#x25CB;</span>
}

export function CronJobsPanel() {
  const t = useTranslations('dashboard')
  const queryClient = useQueryClient()
  const [runningId, setRunningId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const { data: cronData } = useQuery({
    queryKey: ['cron-summary'],
    queryFn: () => fetch('/api/cron').then(r => r.json()),
    refetchInterval: 30000,
  })

  const jobs: CronJobInfo[] = cronData?.jobs ?? []

  const toggleJob = useCallback(async (id: string, currentEnabled: boolean) => {
    setTogglingId(id)
    try {
      await fetch('/api/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: !currentEnabled }),
      })
      await queryClient.invalidateQueries({ queryKey: ['cron-summary'] })
    } catch { /* ignore */ }
    setTogglingId(null)
  }, [queryClient])

  const runJob = useCallback(async (id: string) => {
    setRunningId(id)
    try {
      await fetch('/api/cron/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch { /* ignore */ }
    setRunningId(null)
  }, [])

  return (
    <div className="cyber-card animate-slide-in delay-400">
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-semibold text-white/80">{t('cronJobs')}</span>
        </div>
        <span className="font-mono text-[10px] text-white/25 tracking-widest">
          {jobs.length} {t('cronJobsTotal')}
        </span>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="p-4 text-center">
            <span className="font-mono text-[10px] text-white/20 tracking-widest">{t('noCronJobs')}</span>
          </div>
        ) : (
          jobs.map(job => (
            <div key={job.id} className="px-4 py-2.5 border-b border-white/[0.05] last:border-0">
              {/* Row 1: status + name + buttons */}
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <StatusIcon status={job.lastStatus} />
                  <span className="text-[13px] font-semibold text-white/80 truncate">{job.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleJob(job.id, job.enabled)}
                    disabled={togglingId === job.id}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded border cursor-pointer transition-colors ${
                      job.enabled
                        ? 'text-emerald-400 bg-emerald-400/15 border-emerald-400/30 hover:bg-emerald-400/25'
                        : 'text-white/30 bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.08]'
                    }`}
                  >
                    {togglingId === job.id ? '...' : job.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => runJob(job.id)}
                    disabled={runningId === job.id}
                    className="px-1.5 py-0.5 text-[10px] rounded border border-white/[0.1] bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70 cursor-pointer transition-colors"
                  >
                    {runningId === job.id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <Play className="w-2.5 h-2.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Row 2: schedule */}
              <div className="font-mono text-[11px] text-white/30 mb-0.5">
                {formatSchedule(job)}
              </div>

              {/* Row 3: next + last */}
              <div className="font-mono text-[11px] text-white/25">
                Next: {formatNextRun(job.nextRunAtMs, job.enabled)} · Last: {formatLastDuration(job.lastDurationMs)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
