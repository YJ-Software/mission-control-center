'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import {
  CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, Bot,
  Play, Trash2, Save, RotateCcw, Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import { CronJobForm, type CronJobFormData } from './cron-job-form'
import { CronRunHistory } from './cron-run-history'
import type { CronJobInfo } from '@/lib/morning-report/cron-cli'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CronJobCardProps {
  job: CronJobInfo
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  togglePending?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jobToFormData(job: CronJobInfo): CronJobFormData {
  return {
    name: job.name,
    description: job.description ?? '',
    scheduleKind: job.scheduleKind ?? 'cron',
    cron: job.schedule ?? '',
    at: job.scheduleAt ?? '',
    every: job.scheduleEveryMs ? `${job.scheduleEveryMs}ms` : '',
    timezone: job.timezone ?? 'Asia/Taipei',
    stagger: job.staggerMs ? `${job.staggerMs}ms` : '',
    sessionTarget: job.sessionTarget ?? 'isolated',
    message: job.message ?? '',
    systemEvent: job.systemEventText ?? '',
    agentId: job.agentId ?? '',
    model: job.model ?? '',
    thinking: job.thinking ?? '',
    timeoutSeconds: job.timeoutSeconds ?? 300,
    deliveryMode: job.deliveryMode ?? 'announce',
    channel: job.deliveryChannel ?? 'last',
    to: job.deliveryTo ?? '',
    webhookUrl: job.deliveryMode === 'webhook' ? (job.deliveryTo ?? '') : '',
    bestEffort: job.deliveryBestEffort ?? false,
    enabled: job.enabled,
    deleteAfterRun: job.deleteAfterRun ?? false,
    wake: 'now',
  }
}

function formDataToApiPayload(id: string, form: CronJobFormData) {
  const payload: Record<string, any> = { id }

  payload.name = form.name
  payload.enabled = form.enabled

  // Schedule – only send the field matching the current kind
  if (form.scheduleKind === 'at') {
    payload.at = form.at
  } else if (form.scheduleKind === 'every') {
    payload.every = form.every
  } else if (form.scheduleKind === 'cron' && form.cron) {
    payload.schedule = form.cron
  }

  payload.timezone = form.timezone
  if (form.stagger) payload.stagger = form.stagger
  payload.session = form.sessionTarget
  payload.deleteAfterRun = form.deleteAfterRun
  payload.wake = form.wake

  // Payload (message / systemEvent / model / thinking / timeout)
  payload.payload = {
    message: form.sessionTarget === 'isolated' ? form.message : undefined,
    systemEvent: form.sessionTarget === 'main' ? form.systemEvent : undefined,
    model: form.model || undefined,
    thinking: form.thinking || undefined,
    timeoutSeconds: form.timeoutSeconds,
  }

  // Agent
  if (form.agentId) {
    payload.agentId = form.agentId
  } else {
    payload.clearAgent = true
  }

  // Delivery
  payload.deliveryMode = form.deliveryMode
  if (form.deliveryMode === 'announce') {
    payload.channel = form.channel
    payload.to = form.to
  } else if (form.deliveryMode === 'webhook') {
    payload.to = form.webhookUrl
  }
  payload.bestEffort = form.bestEffort

  return payload
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CronJobCard({ job, onToggle, onDelete, togglePending }: CronJobCardProps) {
  const t = useTranslations('cronJobs')
  const tc = useTranslations('common')
  const locale = useLocale()
  const queryClient = useQueryClient()

  const [expanded, setExpanded] = useState(false)
  const [formData, setFormData] = useState<CronJobFormData>(() => jobToFormData(job))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [running, setRunning] = useState(false)

  // Sync form data when job prop changes
  useEffect(() => {
    setFormData(jobToFormData(job))
  }, [job])

  // Detect changes
  const baseline = jobToFormData(job)
  const hasChanges = JSON.stringify(formData) !== JSON.stringify(baseline)

  // ---- Save mutation ----
  const saveMutation = useMutation({
    mutationFn: async (data: CronJobFormData) => {
      const res = await fetch('/api/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formDataToApiPayload(job.id, data)),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `save failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      await saveMutation.mutateAsync(formData)
    } finally {
      setSaving(false)
    }
  }, [formData, saveMutation])

  const handleReset = () => {
    setFormData(jobToFormData(job))
  }

  // ---- Run mutation ----
  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/cron/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, mode: 'force' }),
      })
      if (!res.ok) throw new Error('run failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      queryClient.invalidateQueries({ queryKey: ['cron-runs', job.id] })
    },
  })

  const handleRun = async () => {
    setRunning(true)
    try {
      await runMutation.mutateAsync()
    } finally {
      setRunning(false)
    }
  }

  // ---- Delete handlers ----
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(true)
  }
  const handleConfirmYes = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(job.id)
    setConfirmDelete(false)
  }
  const handleConfirmNo = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(false)
  }

  // ---- Schedule badge helpers ----
  const scheduleKindLabel =
    job.scheduleKind === 'at' ? t('badgeOneShot')
    : job.scheduleKind === 'every' ? t('badgeInterval')
    : t('badgeCron')

  const scheduleValue =
    job.scheduleKind === 'at' ? job.scheduleAt
    : job.scheduleKind === 'every' ? (job.scheduleEveryMs ? `${job.scheduleEveryMs}ms` : '')
    : job.schedule

  return (
    <div className={`cyber-card transition-all ${job.enabled ? '' : 'opacity-50'}`}>
      {/* ============ Collapsed header ============ */}
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          {/* Status icon */}
          <div className="mt-0.5 shrink-0">
            {job.lastStatus === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : job.lastStatus === 'error' ? (
              <XCircle className="w-4 h-4 text-red-400" />
            ) : (
              <Clock className="w-4 h-4 text-white/30" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/85 font-medium">{job.name}</p>

                {/* Badges row */}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {job.enabled ? (
                    <Badge variant="success" className="text-xs px-1.5 py-0">
                      {t('enabled')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs px-1.5 py-0 text-white/30">
                      {t('disabled')}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs px-1.5 py-0">
                    {scheduleKindLabel}
                  </Badge>
                  <Badge
                    variant={job.sessionTarget === 'main' ? 'purple' : 'default'}
                    className="text-xs px-1.5 py-0"
                  >
                    {job.sessionTarget === 'main' ? t('badgeMain') : t('badgeIsolated')}
                  </Badge>

                  {scheduleValue && (
                    <span className="font-mono text-xs text-white/35">{scheduleValue}</span>
                  )}
                  {job.timezone && (
                    <span className="font-mono text-xs text-white/30">{job.timezone}</span>
                  )}
                  {job.agentId && (
                    <span className="flex items-center gap-1 font-mono text-xs text-white/35">
                      <Bot className="w-3 h-3" />
                      {job.agentId}
                    </span>
                  )}
                  {job.model && (
                    <Badge variant="purple" className="font-mono text-xs px-1.5 py-0">
                      {job.model}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Right side buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className={`font-mono text-xs tracking-wide px-3 py-1 rounded-lg transition-all ${
                    job.enabled
                      ? 'border border-white/[0.1] text-white/35 hover:border-red-400/25 hover:text-red-400/70'
                      : 'bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(job.id, !job.enabled)
                  }}
                  disabled={togglePending}
                >
                  {job.enabled ? t('disable') : t('enable')}
                </button>
                <button
                  className="rounded-lg border border-white/[0.08] text-white/30 hover:text-white/60 transition-colors p-1 hover:bg-white/[0.05]"
                  onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
                >
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Bottom row: run times */}
            <div className="flex items-center gap-4 mt-2">
              {job.nextRunAtMs != null && (
                <div className="font-mono text-xs text-white/30">
                  <span className="text-white/40">{t('nextLabel')}</span>
                  <span className="text-yellow-400/70">
                    {new Date(job.nextRunAtMs).toLocaleString('zh-TW', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              )}
              {job.lastRunAtMs != null && (
                <div className="font-mono text-xs text-white/30">
                  <span className="text-white/40">{t('lastLabel')}</span>
                  <span className="text-yellow-400/70">
                    {formatRelativeTime(new Date(job.lastRunAtMs), locale)}
                    {job.lastDurationMs != null && ` (${(job.lastDurationMs / 1000).toFixed(0)}s)`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============ Expanded areas ============ */}
      {expanded && (
        <>
          {/* Area 1: Edit Form */}
          <div className="border-t border-white/[0.06] mt-0 pt-4 px-4 pb-4">
            <CronJobForm value={formData} onChange={setFormData} mode="edit" />

            {/* Save / Reset buttons */}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                {tc('save')}
              </button>
              {hasChanges && !saving && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 text-white/30 hover:text-white/50 text-xs font-mono px-2 py-1.5 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {tc('reset')}
                </button>
              )}
              {saving && (
                <span className="flex items-center gap-1 text-xs font-mono text-amber-400 animate-in fade-in duration-300">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {tc('savingInProgress')}
                </span>
              )}
              {saved && !hasChanges && !saving && (
                <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 animate-in fade-in duration-300">
                  <CheckCircle2 className="w-3 h-3" />
                  {t('jobUpdated')}
                </span>
              )}
            </div>
          </div>

          {/* Area 2: Actions */}
          <div className="border-t border-white/[0.06] mt-0 pt-4 px-4 pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={handleRun}
                disabled={running}
                className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {running ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {running ? t('running') : t('runNow')}
              </button>

              <button
                onClick={handleDeleteClick}
                className="flex items-center gap-1.5 text-red-400/50 hover:text-red-400 text-xs font-mono px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {t('deleteJob')}
              </button>

              {confirmDelete && (
                <span className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="text-red-400">{tc('confirmQuestion')}</span>
                  <button
                    onClick={handleConfirmYes}
                    className="text-red-400 hover:text-red-300 underline"
                  >
                    {tc('yes')}
                  </button>
                  <button
                    onClick={handleConfirmNo}
                    className="text-white/40 hover:text-white/60 underline"
                  >
                    {tc('no')}
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Area 3: Run History */}
          <div className="border-t border-white/[0.06] mt-0 pt-4 px-4 pb-4">
            <h4 className="text-xs font-mono tracking-wider text-white/50 uppercase mb-3">
              {t('runHistory')}
            </h4>
            <CronRunHistory jobId={job.id} />
          </div>
        </>
      )}
    </div>
  )
}
