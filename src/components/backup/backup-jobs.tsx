'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus, Trash2, ChevronDown, ChevronUp, Loader2, CheckCircle2,
  Play, FileText,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackupJob {
  id: string
  name: string
  destinationId: string
  scheduleId: string
  retainCount: number
  sourceIds: string | string[]
  includeOpenClaw: number
  enabled: number
  model: string | null
  destinationName: string
  scheduleName: string
  lastRun: number | null
  lastStatus: string | null
}

interface Destination {
  id: string
  name: string
  type: string
}

interface Schedule {
  id: string
  name: string
  type: string
}

interface Source {
  id: string
  name: string
  path: string
  description: string | null
}

interface BackupLog {
  id: string
  jobId: string
  status: string
  startedAt: number
  completedAt: number | null
  fileSize: number | null
  filePath: string | null
  destination: string | null
  notes: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(unix: number): string {
  const diff = Date.now() / 1000 - unix
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return '—'
  const s = end - start
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

function statusBadgeCls(status: string): string {
  return STATUS_BADGE[status] ?? 'bg-white/10 text-white/50 border-white/10'
}

// ---------------------------------------------------------------------------
// Toggle Switch
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors
        ${checked ? 'bg-cyan-500/60 border-cyan-400/50' : 'bg-white/[0.08] border-white/[0.12]'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`pointer-events-none mt-0.5 ml-0.5 inline-block h-4 w-4 rounded-full bg-white shadow
          transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Log Row (expandable)
// ---------------------------------------------------------------------------

function LogRow({ log }: { log: BackupLog }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-3 text-xs font-mono">
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-white/30"
          >
            <ChevronDown className="w-3 h-3" />
          </motion.span>
          <span className="text-white/40 w-28 shrink-0">{formatTimestamp(log.startedAt)}</span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase shrink-0 ${statusBadgeCls(log.status)}`}>
            {log.status}
          </span>
          <span className="text-white/40 w-16 shrink-0">{formatDuration(log.startedAt, log.completedAt)}</span>
          <span className="text-white/35">{formatBytes(log.fileSize)}</span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key={`log-detail-${log.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-3 pt-1 space-y-2 bg-black/20 text-xs font-mono border-t border-white/[0.05]">
              {log.error && (
                <div>
                  <span className="text-red-400/70 uppercase tracking-wider text-[10px]">Error</span>
                  <p className="text-red-400 mt-0.5 whitespace-pre-wrap break-all">{log.error}</p>
                </div>
              )}
              {log.filePath && (
                <div>
                  <span className="text-white/30 uppercase tracking-wider text-[10px]">File Path</span>
                  <p className="text-white/50 mt-0.5 break-all">{log.filePath}</p>
                </div>
              )}
              {log.notes && (
                <div>
                  <span className="text-white/30 uppercase tracking-wider text-[10px]">Notes</span>
                  <p className="text-white/50 mt-0.5">{log.notes}</p>
                </div>
              )}
              {log.destination && (
                <div>
                  <span className="text-white/30 uppercase tracking-wider text-[10px]">Destination</span>
                  <p className="text-white/50 mt-0.5">{log.destination}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ---------------------------------------------------------------------------
// Log Viewer
// ---------------------------------------------------------------------------

function LogViewer({ jobId }: { jobId: string }) {
  const t = useTranslations('backup.jobs')

  const { data: logs = [], isLoading } = useQuery<BackupLog[]>({
    queryKey: ['backup-logs', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/backup/logs?jobId=${jobId}`)
      if (!res.ok) throw new Error('Failed to load logs')
      return res.json()
    },
    refetchInterval: 5000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/30 text-xs font-mono py-3 px-3">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <p className="text-white/25 text-xs font-mono py-3 px-3">{t('noLogs')}</p>
    )
  }

  return (
    <div className="divide-y divide-white/[0.04]">
      {logs.map((log) => (
        <LogRow key={log.id} log={log} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job Form
// ---------------------------------------------------------------------------

const RETAIN_PRESETS = [1, 2, 3, 7, 14]

interface JobFormState {
  name: string
  destinationId: string
  scheduleId: string
  retainCount: number
  retainCustom: string
  retainMode: 'preset' | 'custom'
  sourceIds: string[]
  includeOpenClaw: boolean
  model: string
}

function initJobForm(job?: BackupJob): JobFormState {
  if (!job) {
    return {
      name: '',
      destinationId: '',
      scheduleId: '',
      retainCount: 3,
      retainCustom: '',
      retainMode: 'preset',
      sourceIds: [],
      includeOpenClaw: true,
      model: '',
    }
  }
  const isPreset = RETAIN_PRESETS.includes(job.retainCount)
  return {
    name: job.name,
    destinationId: job.destinationId,
    scheduleId: job.scheduleId,
    retainCount: job.retainCount,
    retainCustom: isPreset ? '' : String(job.retainCount),
    retainMode: isPreset ? 'preset' : 'custom',
    sourceIds: Array.isArray(job.sourceIds) ? job.sourceIds : JSON.parse(job.sourceIds || '[]'),
    includeOpenClaw: job.includeOpenClaw !== 0,
    model: job.model ?? '',
  }
}

interface JobFormProps {
  initial?: BackupJob
  destinations: Destination[]
  schedules: Schedule[]
  sources: Source[]
  onSave: (payload: {
    name: string
    destinationId: string
    scheduleId: string
    retainCount: number
    sourceIds: string[]
    includeOpenClaw: boolean
    model: string
  }) => void
  onCancel: () => void
  saving: boolean
}

function JobForm({ initial, destinations, schedules, sources, onSave, onCancel, saving }: JobFormProps) {
  const t = useTranslations('backup.jobs')
  const tc = useTranslations('backup.common')

  const [form, setForm] = useState<JobFormState>(() => initJobForm(initial))

  const inputCls =
    'bg-white/[0.06] text-white/70 border border-white/[0.1] rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500/50'
  const selectCls =
    'bg-[#1a1f2e] text-white/70 border border-white/[0.1] rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500/50 [&>option]:bg-[#1a1f2e] [&>option]:text-white/80'

  const effectiveRetain =
    form.retainMode === 'preset'
      ? form.retainCount
      : (parseInt(form.retainCustom, 10) || 1)

  const toggleSource = (id: string) => {
    setForm((f) => ({
      ...f,
      sourceIds: f.sourceIds.includes(id)
        ? f.sourceIds.filter((s) => s !== id)
        : [...f.sourceIds, id],
    }))
  }

  const hasAnySources = form.includeOpenClaw || form.sourceIds.length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      name: form.name.trim(),
      destinationId: form.destinationId,
      scheduleId: form.scheduleId,
      retainCount: effectiveRetain,
      sourceIds: form.sourceIds,
      includeOpenClaw: form.includeOpenClaw,
      model: form.model.trim(),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-3 border-t border-white/[0.06] pt-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-1">{t('name')}</label>
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </div>

      {/* Destination */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-1">{t('destination')}</label>
        <select
          className={selectCls}
          value={form.destinationId}
          onChange={(e) => setForm((f) => ({ ...f, destinationId: e.target.value }))}
          required
        >
          <option value="">—</option>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Schedule */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-1">{t('schedule')}</label>
        <select
          className={selectCls}
          value={form.scheduleId}
          onChange={(e) => setForm((f) => ({ ...f, scheduleId: e.target.value }))}
          required
        >
          <option value="">—</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Retain Count */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-2">{t('retainCount')}</label>
        <div className="flex items-center gap-2 flex-wrap">
          {RETAIN_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setForm((f) => ({ ...f, retainMode: 'preset', retainCount: n }))}
              className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors
                ${form.retainMode === 'preset' && form.retainCount === n
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                  : 'border-white/[0.1] text-white/40 hover:text-white/60'
                }`}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, retainMode: 'custom' }))}
            className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors
              ${form.retainMode === 'custom'
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                : 'border-white/[0.1] text-white/40 hover:text-white/60'
              }`}
          >
            {t('retainCustom')}
          </button>
          {form.retainMode === 'custom' && (
            <input
              type="number"
              min={1}
              className="w-20 bg-white/[0.06] text-white/70 border border-cyan-500/30 rounded-md px-2 py-1 text-sm focus:outline-none"
              value={form.retainCustom}
              onChange={(e) => setForm((f) => ({ ...f, retainCustom: e.target.value }))}
              placeholder="n"
            />
          )}
        </div>
      </div>

      {/* Sources */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-2">{t('sources')}</label>
        <div className="space-y-1.5">
          {/* OpenClaw — toggleable, but at least one source required */}
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={form.includeOpenClaw}
              onChange={() => setForm((f) => ({ ...f, includeOpenClaw: !f.includeOpenClaw }))}
              className="accent-cyan-400"
            />
            <span>OpenClaw</span>
          </label>
          {sources.map((src) => (
            <label key={src.id} className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={form.sourceIds.includes(src.id)}
                onChange={() => toggleSource(src.id)}
                className="accent-cyan-400"
              />
              <span>{src.name}</span>
              {src.description && (
                <span className="text-white/30 text-xs font-mono">{src.description}</span>
              )}
            </label>
          ))}
        </div>
        {!hasAnySources && (
          <p className="text-xs text-red-400/80 mt-1.5">{t('sourceRequired')}</p>
        )}
      </div>

      {/* Model */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-1">{t('model')}</label>
        <input
          className={inputCls}
          value={form.model}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          placeholder={t('modelOptional')}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !form.name.trim() || !form.destinationId || !form.scheduleId || !hasAnySources}
          className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400
            text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-500/30
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {tc('save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-white/40 hover:text-white/60 text-xs font-mono px-3 py-1.5 transition-colors"
        >
          {tc('cancel')}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Job Row (with manage drawer)
// ---------------------------------------------------------------------------

interface JobRowProps {
  job: BackupJob
  destinations: Destination[]
  schedules: Schedule[]
  sources: Source[]
  backupToken: string
}

function JobRow({ job, destinations, schedules, sources, backupToken }: JobRowProps) {
  const t = useTranslations('backup.jobs')
  const tc = useTranslations('backup.common')
  const queryClient = useQueryClient()

  const [manageOpen, setManageOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Toggle enabled
  const toggleMutation = useMutation({
    mutationFn: async (enabled: number) => {
      const res = await fetch('/api/backup/jobs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, enabled }),
      })
      if (!res.ok) throw new Error('Toggle failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-jobs'] }),
  })

  // Update
  const updateMutation = useMutation({
    mutationFn: async (payload: {
      name: string; destinationId: string; scheduleId: string
      retainCount: number; sourceIds: string[]; includeOpenClaw: boolean; model: string
    }) => {
      const res = await fetch('/api/backup/jobs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, ...payload }),
      })
      if (!res.ok) throw new Error('Update failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-jobs'] })
    },
  })

  // Delete
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/backup/jobs?id=${job.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-jobs'] }),
  })

  // Run now
  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/backup/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backup-Token': backupToken,
        },
        body: JSON.stringify({ jobId: job.id }),
      })
      if (!res.ok) throw new Error('Run failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-logs', job.id] })
      queryClient.invalidateQueries({ queryKey: ['backup-jobs'] })
    },
  })

  return (
    <div className={`cyber-card transition-all ${job.enabled ? '' : 'opacity-60'}`}>
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/85 font-medium truncate">{job.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="font-mono text-xs text-white/35">{job.destinationName}</span>
              <span className="text-white/15">·</span>
              <span className="font-mono text-xs text-white/35">{job.scheduleName}</span>
            </div>
          </div>

          {/* Last run */}
          <div className="text-xs font-mono text-white/35 shrink-0 w-20 text-right">
            {job.lastRun ? relativeTime(job.lastRun) : '—'}
          </div>

          {/* Last status badge */}
          <div className="shrink-0 w-24 flex justify-end">
            {job.lastStatus ? (
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase ${statusBadgeCls(job.lastStatus)}`}>
                {job.lastStatus}
              </span>
            ) : (
              <span className="text-white/20 text-xs font-mono">—</span>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <ToggleSwitch
              checked={job.enabled === 1}
              onChange={(v) => toggleMutation.mutate(v ? 1 : 0)}
              disabled={toggleMutation.isPending}
            />
          </div>

          {/* Manage button */}
          <button
            onClick={() => { setManageOpen((v) => !v); setConfirmDelete(false) }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono
              border border-white/[0.1] text-white/40 hover:text-white/70 hover:border-white/20
              transition-colors"
          >
            {t('manage')}
            {manageOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Manage drawer */}
      <AnimatePresence initial={false}>
        {manageOpen && (
          <motion.div
            key={`manage-${job.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <div className="p-4 space-y-4">
              {/* Edit form */}
              <JobForm
                initial={job}
                destinations={destinations}
                schedules={schedules}
                sources={sources}
                onSave={(payload) => updateMutation.mutate(payload)}
                onCancel={() => setManageOpen(false)}
                saving={updateMutation.isPending}
              />

              {updateMutation.isSuccess && (
                <span className="flex items-center gap-1 text-xs font-mono text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {tc('save')}
                </span>
              )}

              {/* Actions row: Run Now + Delete */}
              <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/[0.06]">
                {/* Run Now */}
                <button
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending}
                  className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400
                    text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-emerald-500/20
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {runMutation.isPending
                    ? <><Loader2 className="w-3 h-3 animate-spin" />{t('running')}</>
                    : <><Play className="w-3 h-3" />{t('runNow')}</>
                  }
                </button>

                {/* View Logs */}
                <button
                  onClick={() => setLogsOpen((v) => !v)}
                  className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.1] text-white/50
                    text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-white/[0.08] hover:text-white/70"
                >
                  <FileText className="w-3 h-3" />
                  {t('logs')}
                  {logsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {/* Delete */}
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 text-red-400/50 hover:text-red-400
                      text-xs font-mono px-3 py-1.5 rounded-lg transition-colors ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                    {tc('delete')}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-mono ml-auto">
                    <span className="text-red-400">{t('deleteConfirm')}</span>
                    <button
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="text-red-400 hover:text-red-300 underline disabled:opacity-50"
                    >
                      {tc('confirm')}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-white/40 hover:text-white/60 underline"
                    >
                      {tc('cancel')}
                    </button>
                  </span>
                )}
              </div>

              {/* Log viewer */}
              <AnimatePresence initial={false}>
                {logsOpen && (
                  <motion.div
                    key={`logs-${job.id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border border-white/[0.07] rounded-lg bg-black/20 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05]">
                        <FileText className="w-3 h-3 text-white/30" />
                        <span className="text-xs font-mono text-white/40 uppercase tracking-wider">{t('logs')}</span>
                      </div>
                      <LogViewer jobId={job.id} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Job Modal (inline panel)
// ---------------------------------------------------------------------------

interface NewJobPanelProps {
  destinations: Destination[]
  schedules: Schedule[]
  sources: Source[]
  onClose: () => void
}

function NewJobPanel({ destinations, schedules, sources, onClose }: NewJobPanelProps) {
  const t = useTranslations('backup.jobs')
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string; destinationId: string; scheduleId: string
      retainCount: number; sourceIds: string[]; includeOpenClaw: boolean; model: string
    }) => {
      const res = await fetch('/api/backup/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Create failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-jobs'] })
      onClose()
    },
  })

  return (
    <div className="cyber-card p-4">
      <p className="text-xs font-mono text-white/50 uppercase tracking-wider">{t('addNew')}</p>
      <JobForm
        destinations={destinations}
        schedules={schedules}
        sources={sources}
        onSave={(payload) => createMutation.mutate(payload)}
        onCancel={onClose}
        saving={createMutation.isPending}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BackupJobs() {
  const t = useTranslations('backup.jobs')

  const [showAdd, setShowAdd] = useState(false)

  const { data: jobs = [], isLoading: loadingJobs } = useQuery<BackupJob[]>({
    queryKey: ['backup-jobs'],
    queryFn: async () => {
      const res = await fetch('/api/backup/jobs')
      if (!res.ok) throw new Error('Failed to load jobs')
      return res.json()
    },
  })

  const { data: destinations = [] } = useQuery<Destination[]>({
    queryKey: ['backup-destinations'],
    queryFn: async () => {
      const res = await fetch('/api/backup/destinations')
      if (!res.ok) throw new Error('Failed to load destinations')
      return res.json()
    },
  })

  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ['backup-schedules'],
    queryFn: async () => {
      const res = await fetch('/api/backup/schedules')
      if (!res.ok) throw new Error('Failed to load schedules')
      return res.json()
    },
  })

  const { data: sources = [] } = useQuery<Source[]>({
    queryKey: ['backup-sources'],
    queryFn: async () => {
      const res = await fetch('/api/backup/sources')
      if (!res.ok) throw new Error('Failed to load sources')
      return res.json()
    },
  })

  const { data: dashboardData } = useQuery<{ backupToken: string }>({
    queryKey: ['backup-dashboard-token'],
    queryFn: async () => {
      const res = await fetch('/api/backup?type=dashboard')
      if (!res.ok) throw new Error('Failed to load token')
      return res.json()
    },
  })

  const backupToken = dashboardData?.backupToken ?? ''

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-mono tracking-wider text-white/70 uppercase">
          {t('title')}
        </h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400
            text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-500/20"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('addNew')}
        </button>
      </div>

      {/* New job panel */}
      <AnimatePresence initial={false}>
        {showAdd && (
          <motion.div
            key="new-job-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <NewJobPanel
              destinations={destinations}
              schedules={schedules}
              sources={sources}
              onClose={() => setShowAdd(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table header */}
      {!loadingJobs && jobs.length > 0 && (
        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 text-[10px] font-mono text-white/25 uppercase tracking-wider border-b border-white/[0.05]">
          <span>{t('name')}</span>
          <span className="w-20 text-right">{t('lastRun')}</span>
          <span className="w-24 text-right">Status</span>
          <span className="w-9 text-center">{t('enabled')}</span>
          <span className="w-16 text-center">{t('manage')}</span>
        </div>
      )}

      {/* Loading */}
      {loadingJobs && (
        <div className="flex items-center gap-2 text-white/40 text-sm font-mono p-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      )}

      {/* Empty */}
      {!loadingJobs && jobs.length === 0 && !showAdd && (
        <div className="text-white/30 text-sm font-mono p-6 cyber-card text-center">
          — {t('addNew')} —
        </div>
      )}

      {/* Job list */}
      <div className="space-y-3">
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            destinations={destinations}
            schedules={schedules}
            sources={sources}
            backupToken={backupToken}
          />
        ))}
      </div>
    </div>
  )
}
