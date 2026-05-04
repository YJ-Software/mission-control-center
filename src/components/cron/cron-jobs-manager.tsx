'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CronJobCard } from './cron-job-card'
import { CronJobForm, defaultFormData, type CronJobFormData } from './cron-job-form'
import type { CronJobInfo } from '@/lib/morning-report/cron-cli'

export function CronJobsManager() {
  const t = useTranslations('cronJobs')
  const tc = useTranslations('common')
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newJob, setNewJob] = useState<CronJobFormData>(defaultFormData)

  // Fetch jobs
  const { data, isLoading } = useQuery<{ jobs: CronJobInfo[] }>({
    queryKey: ['cron-jobs'],
    queryFn: () => fetch('/api/cron').then(r => r.json()),
    refetchInterval: 30000,
  })

  // Toggle mutation (passed to cards)
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetch('/api/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
  })

  // Delete mutation (passed to cards)
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/cron?id=${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CronJobFormData) =>
      fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          schedule: data.scheduleKind === 'cron' ? data.cron : undefined,
          at: data.scheduleKind === 'at' ? data.at : undefined,
          every: data.scheduleKind === 'every' ? data.every : undefined,
          timezone: data.timezone,
          session: data.sessionTarget,
          message: data.sessionTarget === 'isolated' ? data.message : undefined,
          systemEvent: data.sessionTarget === 'main' ? data.systemEvent : undefined,
          agentId: data.agentId || undefined,
          model: data.model || undefined,
          thinking: data.thinking || undefined,
          timeoutSeconds: data.timeoutSeconds,
          deliveryMode: data.deliveryMode,
          channel: data.deliveryMode === 'announce' ? data.channel : undefined,
          to: data.deliveryMode === 'announce' ? data.to :
            data.deliveryMode === 'webhook' ? data.webhookUrl : undefined,
          bestEffort: data.bestEffort,
          deleteAfterRun: data.deleteAfterRun,
          wake: data.wake,
          stagger: data.stagger || undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      setCreateOpen(false)
      setNewJob(defaultFormData)
    },
  })

  const jobs = data?.jobs || []
  const enabledCount = jobs.filter(j => j.enabled).length

  // Validate create form: name required + schedule required based on kind
  const isCreateValid =
    newJob.name.trim().length > 0 &&
    (
      (newJob.scheduleKind === 'cron' && newJob.cron.trim().length > 0) ||
      (newJob.scheduleKind === 'at' && newJob.at.trim().length > 0) ||
      (newJob.scheduleKind === 'every' && newJob.every.trim().length > 0)
    )

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="font-mono text-white/20 tracking-[0.3em] text-xs typewriter">{t('loadingJobs')}</span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header: Stats + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400/60" />
            <span className="font-mono text-xs tracking-wide text-white/40">
              {t('jobCount', { count: jobs.length })}
            </span>
          </div>
          <span className="font-mono text-xs tracking-widests px-2 py-0.5 rounded border border-emerald-400/25 text-emerald-400/70">
            {t('enabledCount', { count: enabledCount })}
          </span>
          <span className="font-mono text-xs tracking-widests px-2 py-0.5 rounded border border-white/[0.1] text-white/35">
            {t('disabledCount', { count: jobs.length - enabledCount })}
          </span>
        </div>

        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setNewJob(defaultFormData)
        }}>
          <DialogTrigger asChild>
            <button className="flex items-center gap-1.5 font-mono text-xs tracking-wide px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 transition-all">
              <Plus className="w-3 h-3" />
              {t('addJob')}
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[#0a0a1a] border-white/[0.1] max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm text-white/80">{t('createTitle')}</DialogTitle>
            </DialogHeader>
            <CronJobForm value={newJob} onChange={setNewJob} />
            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <button
                className="font-mono text-xs px-3 py-1.5 rounded-lg text-white/40 hover:text-white/60 transition-colors"
                onClick={() => setCreateOpen(false)}
              >
                {tc('cancel')}
              </button>
              <button
                className="flex items-center font-mono text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-30 transition-all"
                onClick={() => createMutation.mutate(newJob)}
                disabled={!isCreateValid || createMutation.isPending}
              >
                <Plus className="w-3 h-3 mr-1.5" />
                {t('addJob')}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Job list */}
      <div className="space-y-3">
        {jobs.map(job => (
          <CronJobCard
            key={job.id}
            job={job}
            onToggle={(id, enabled) => toggleMutation.mutate({ id, enabled })}
            onDelete={(id) => deleteMutation.mutate(id)}
            togglePending={toggleMutation.isPending}
          />
        ))}
      </div>
    </div>
  )
}
