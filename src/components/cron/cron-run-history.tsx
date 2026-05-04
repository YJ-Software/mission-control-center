'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { CheckCircle2, XCircle, MinusCircle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'

interface RunEntry {
  startedAt?: string | number
  endedAt?: string | number
  status?: string
  durationMs?: number
  error?: string
}

interface CronRunHistoryProps {
  jobId: string
}

const statusConfig = {
  ok: {
    variant: 'success' as const,
    icon: CheckCircle2,
    i18nKey: 'runStatusOk' as const,
  },
  error: {
    variant: 'destructive' as const,
    icon: XCircle,
    i18nKey: 'runStatusError' as const,
  },
  skipped: {
    variant: 'outline' as const,
    icon: MinusCircle,
    i18nKey: 'runStatusSkipped' as const,
  },
}

export function CronRunHistory({ jobId }: CronRunHistoryProps) {
  const t = useTranslations('cronJobs')
  const locale = useLocale()

  const { data, isLoading } = useQuery<{ runs: RunEntry[] }>({
    queryKey: ['cron-runs', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/cron/runs?id=${jobId}&limit=20`)
      if (!res.ok) throw new Error('Failed to fetch run history')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const runs = data?.runs ?? []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-white/30" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-white/30">
        {t('noRunHistory')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {runs.map((run, index) => {
        const status = run.status ?? 'skipped'
        const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.skipped
        const Icon = config.icon
        const durationSec = run.durationMs != null ? (run.durationMs / 1000).toFixed(1) : null

        return (
          <div key={index} className="flex items-center gap-3 p-2 bg-white/[0.02] rounded-lg">
            <Icon className="h-3.5 w-3.5 shrink-0" style={{
              color: status === 'ok' ? 'rgb(74 222 128)' : status === 'error' ? 'rgb(248 113 113)' : 'rgb(156 163 175)',
            }} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={config.variant} className="text-xs px-1.5 py-0">
                  {t(config.i18nKey)}
                </Badge>

                {run.startedAt && (
                  <span className="font-mono text-xs text-white/40">
                    {formatRelativeTime(run.startedAt, locale)}
                  </span>
                )}

                {durationSec !== null && (
                  <span className="font-mono text-xs text-white/30">
                    {durationSec}s
                  </span>
                )}
              </div>

              {run.error && (
                <p className="text-xs text-red-400/70 font-mono mt-1 truncate">
                  {run.error}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
