'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  useAgentCronJobs,
  useCronStatus,
  useCronEnabled,
  useRunCron,
  useRemoveCron,
} from '@/hooks/agents/use-agent-cron'
import { AgentContentCard } from './shared/agent-content-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

function formatNext(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function CronJobsTab({ agentId }: { agentId: string | null }) {
  const t = useTranslations('agents.cron')
  const jobs = useAgentCronJobs(agentId)
  const status = useCronStatus()
  const toggle = useCronEnabled(agentId)
  const run = useRunCron(agentId)
  const remove = useRemoveCron(agentId)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AgentContentCard agentId={agentId} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('scheduler')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">{t('enabled')}</div>
            <div>{status.data?.enabled ? t('yes') : t('no')}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t('totalJobs')}</div>
            <div>{status.data?.totalJobs ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t('nextRun')}</div>
            <div>{formatNext(status.data?.nextRunAtMs)}</div>
          </div>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('agentCronJobs')}</CardTitle>
          {agentId ? (
            <Link
              href={`/cron-jobs?new=1&agentId=${encodeURIComponent(agentId)}`}
              className="text-sm text-primary underline"
            >
              {t('add')}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(jobs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noJobs')}</p>
          ) : (
            jobs.data!.map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex flex-col">
                  <span className="font-medium">{j.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('next', { time: formatNext(j.nextRunAtMs) })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={j.enabled}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ id: j.id, enabled: v })}
                  />
                  <Button size="sm" variant="outline" onClick={() => run.mutate(j.id)}>
                    {t('run')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(j.id)}>
                    {t('delete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
