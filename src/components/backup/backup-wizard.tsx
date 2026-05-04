'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Wand2, HardDrive, Globe, FolderOpen, Calendar, Briefcase,
  ChevronRight, ChevronLeft, Check, Plus, Shield, X,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Destination { id: string; name: string; type: string; config: string; enabled: number }
interface Source { id: string; name: string; path: string; enabled: number }
interface Schedule { id: string; name: string; type: string; config: string; enabled: number }

type WizardStep = 'dest' | 'source' | 'schedule' | 'job' | 'done'
const STEPS: WizardStep[] = ['dest', 'source', 'schedule', 'job']

const VALID_HOURLY = [1, 2, 3, 4, 6, 8, 12]
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

const inputClass = 'w-full bg-white/[0.06] text-white/80 border border-white/[0.1] rounded-md px-3 py-2 text-sm placeholder:text-white/25 focus:outline-none focus:border-cyan-500/50'
const btnPrimary = 'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors'
const btnSecondary = 'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white/60 bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1] transition-colors'

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, t }: { current: WizardStep; t: ReturnType<typeof useTranslations> }) {
  const labels = [
    { key: 'dest', icon: HardDrive, label: t('dashboard.wizardStepDest') },
    { key: 'source', icon: FolderOpen, label: t('dashboard.wizardStepSource') },
    { key: 'schedule', icon: Calendar, label: t('dashboard.wizardStepSchedule') },
    { key: 'job', icon: Briefcase, label: t('dashboard.wizardStepJob') },
  ]
  const currentIdx = STEPS.indexOf(current)

  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
      {labels.map((s, i) => {
        const done = i < currentIdx
        const active = s.key === current
        return (
          <div key={s.key} className="flex items-center gap-2 shrink-0">
            {i > 0 && <ChevronRight className="w-3 h-3 text-white/20" />}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              active ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
              done ? 'bg-green-500/15 text-green-400 border border-green-500/20' :
              'bg-white/[0.04] text-white/30 border border-white/[0.06]'
            }`}>
              {done ? <Check className="w-3 h-3" /> : <s.icon className="w-3 h-3" />}
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{i + 1}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Destination
// ---------------------------------------------------------------------------

function StepDest({ value, onChange, t }: {
  value: { mode: 'existing' | 'new'; id: string; name: string; type: 'ftp' | 'local'; localPath: string; ftpIp: string; ftpPort: string; ftpUser: string; ftpPass: string; ftpMode: 'active' | 'passive'; ftpPath: string }
  onChange: (v: typeof value) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { data: destinations = [] } = useQuery<Destination[]>({
    queryKey: ['backup-destinations'],
    queryFn: () => fetch('/api/backup/destinations').then(r => r.json()),
  })

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-white/80 mb-1">{t('dashboard.wizardStepDest')}</div>
        <div className="text-xs text-white/40">{t('dashboard.wizardStepDestDesc')}</div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => onChange({ ...value, mode: 'existing' })}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
            value.mode === 'existing' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'bg-white/[0.04] text-white/40 border-white/[0.06] hover:text-white/60'
          }`}
        >{t('dashboard.wizardSelectExisting')}</button>
        <button
          onClick={() => onChange({ ...value, mode: 'new' })}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
            value.mode === 'new' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'bg-white/[0.04] text-white/40 border-white/[0.06] hover:text-white/60'
          }`}
        ><Plus className="w-3 h-3 inline mr-1" />{t('dashboard.wizardCreateNew')}</button>
      </div>

      {value.mode === 'existing' ? (
        <div className="space-y-2">
          {destinations.length === 0 && <div className="text-xs text-white/30 py-4 text-center">—</div>}
          {destinations.map(d => {
            const selected = value.id === d.id
            return (
              <button key={d.id} onClick={() => onChange({ ...value, id: d.id, name: d.name })}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  selected ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                }`}>
                {d.type === 'ftp' ? <Globe className="w-4 h-4 text-indigo-400" /> : <HardDrive className="w-4 h-4 text-cyan-400" />}
                <div>
                  <div className="text-sm text-white/80">{d.name}</div>
                  <div className="text-[11px] text-white/30">{d.type.toUpperCase()}</div>
                </div>
                {selected && <Check className="w-4 h-4 text-cyan-400 ml-auto" />}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['local', 'ftp'] as const).map(tp => (
              <button key={tp} onClick={() => onChange({ ...value, type: tp })}
                className={`flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
                  value.type === tp ? 'bg-white/[0.08] text-white/80 border-white/[0.15]' : 'bg-white/[0.03] text-white/40 border-white/[0.06]'
                }`}>
                {tp === 'local' ? t('destinations.local') : t('destinations.ftp')}
              </button>
            ))}
          </div>
          <input placeholder={t('schedules.name')} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} className={inputClass} />
          {value.type === 'local' ? (
            <input placeholder="~/backup" value={value.localPath} onChange={e => onChange({ ...value, localPath: e.target.value })} className={inputClass} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input placeholder={t('destinations.ip')} value={value.ftpIp} onChange={e => onChange({ ...value, ftpIp: e.target.value })} className={inputClass} />
              <input placeholder={t('destinations.port')} value={value.ftpPort} onChange={e => onChange({ ...value, ftpPort: e.target.value })} className={inputClass} />
              <input placeholder={t('destinations.username')} value={value.ftpUser} onChange={e => onChange({ ...value, ftpUser: e.target.value })} className={inputClass} />
              <input placeholder={t('destinations.password')} type="password" value={value.ftpPass} onChange={e => onChange({ ...value, ftpPass: e.target.value })} className={inputClass} />
              <input placeholder={t('destinations.remotePath')} value={value.ftpPath} onChange={e => onChange({ ...value, ftpPath: e.target.value })} className={`col-span-2 ${inputClass}`} />
              <div className="col-span-2 flex gap-2">
                {(['passive', 'active'] as const).map(m => (
                  <button key={m} onClick={() => onChange({ ...value, ftpMode: m })}
                    className={`flex-1 px-2 py-1.5 rounded text-xs border ${value.ftpMode === m ? 'bg-white/[0.08] text-white/80 border-white/[0.15]' : 'text-white/40 border-white/[0.06]'}`}>
                    {t(`destinations.${m}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Sources
// ---------------------------------------------------------------------------

function StepSource({ selected, onChange, openClaw, onOpenClawChange, t }: {
  selected: string[]
  onChange: (ids: string[]) => void
  openClaw: boolean
  onOpenClawChange: (v: boolean) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { data: sources = [] } = useQuery<Source[]>({
    queryKey: ['backup-sources'],
    queryFn: () => fetch('/api/backup/sources').then(r => r.json()),
  })

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-white/80 mb-1">{t('dashboard.wizardStepSource')}</div>
        <div className="text-xs text-white/40">{t('dashboard.wizardStepSourceDesc')}</div>
      </div>

      {/* OpenClaw — toggleable */}
      <button
        onClick={() => onOpenClawChange(!openClaw)}
        className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
          openClaw ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
        }`}
      >
        <Shield className="w-4 h-4 text-cyan-400" />
        <div className="flex-1">
          <div className="text-sm text-white/80">{t('sources.openClaw')}</div>
          <div className="text-[11px] text-white/40">{t('sources.openClawDesc')}</div>
        </div>
        <div className={`w-8 h-5 rounded-full flex items-center px-0.5 transition-colors ${
          openClaw ? 'bg-cyan-500/30 justify-end' : 'bg-white/10 justify-start'
        }`}>
          <div className={`w-4 h-4 rounded-full transition-colors ${openClaw ? 'bg-cyan-400' : 'bg-white/30'}`} />
        </div>
      </button>

      {/* At least one source required */}
      {!openClaw && selected.length === 0 && (
        <p className="text-xs text-red-400/80">{t('jobs.sourceRequired')}</p>
      )}

      {/* Extra sources */}
      {sources.filter(s => s.enabled).map(s => {
        const checked = selected.includes(s.id)
        return (
          <button key={s.id}
            onClick={() => onChange(checked ? selected.filter(x => x !== s.id) : [...selected, s.id])}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
              checked ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
            }`}>
            <FolderOpen className="w-4 h-4 text-white/40" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white/80">{s.name}</div>
              <div className="text-[11px] text-white/30 font-mono truncate">{s.path}</div>
            </div>
            {checked && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Schedule
// ---------------------------------------------------------------------------

function StepSchedule({ value, onChange, t }: {
  value: { mode: 'existing' | 'new'; id: string; name: string; type: string; hourlyInterval: number; dailyDays: number[]; dailyTime: string; weeklyDay: number; weeklyTime: string; monthlyDay: number; monthlyTime: string }
  onChange: (v: typeof value) => void
  t: ReturnType<typeof useTranslations>
}) {
  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ['backup-schedules'],
    queryFn: () => fetch('/api/backup/schedules').then(r => r.json()),
  })

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-white/80 mb-1">{t('dashboard.wizardStepSchedule')}</div>
        <div className="text-xs text-white/40">{t('dashboard.wizardStepScheduleDesc')}</div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => onChange({ ...value, mode: 'existing' })}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
            value.mode === 'existing' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'bg-white/[0.04] text-white/40 border-white/[0.06]'
          }`}>{t('dashboard.wizardSelectExisting')}</button>
        <button onClick={() => onChange({ ...value, mode: 'new' })}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
            value.mode === 'new' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'bg-white/[0.04] text-white/40 border-white/[0.06]'
          }`}><Plus className="w-3 h-3 inline mr-1" />{t('dashboard.wizardCreateNew')}</button>
      </div>

      {value.mode === 'existing' ? (
        <div className="space-y-2">
          {schedules.length === 0 && <div className="text-xs text-white/30 py-4 text-center">—</div>}
          {schedules.map(s => {
            const selected = value.id === s.id
            return (
              <button key={s.id} onClick={() => onChange({ ...value, id: s.id, name: s.name })}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  selected ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                }`}>
                <Calendar className="w-4 h-4 text-white/40" />
                <div>
                  <div className="text-sm text-white/80">{s.name}</div>
                  <div className="text-[11px] text-white/30">{s.type}</div>
                </div>
                {selected && <Check className="w-4 h-4 text-cyan-400 ml-auto" />}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <input placeholder={t('schedules.name')} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} className={inputClass} />
          <div className="flex gap-1.5">
            {(['hourly', 'daily', 'weekly', 'monthly'] as const).map(tp => (
              <button key={tp} onClick={() => onChange({ ...value, type: tp })}
                className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                  value.type === tp ? 'bg-white/[0.08] text-white/80 border-white/[0.15]' : 'text-white/40 border-white/[0.06]'
                }`}>{t(`schedules.${tp}`)}</button>
            ))}
          </div>

          {value.type === 'hourly' && (
            <div className="flex flex-wrap gap-1.5">
              {VALID_HOURLY.map(n => (
                <button key={n} onClick={() => onChange({ ...value, hourlyInterval: n })}
                  className={`px-3 py-1.5 rounded text-xs border ${value.hourlyInterval === n ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-white/40 border-white/[0.06]'}`}>
                  {n === 1 ? t('schedules.everyHour') : `${n}h`}
                </button>
              ))}
            </div>
          )}

          {value.type === 'daily' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((d, i) => {
                  const on = value.dailyDays.includes(i)
                  return (
                    <button key={d} onClick={() => onChange({ ...value, dailyDays: on ? value.dailyDays.filter(x => x !== i) : [...value.dailyDays, i] })}
                      className={`px-2.5 py-1.5 rounded text-xs border ${on ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-white/40 border-white/[0.06]'}`}>
                      {t(`schedules.${d}`).slice(0, 3)}
                    </button>
                  )
                })}
              </div>
              <input type="time" value={value.dailyTime} onChange={e => onChange({ ...value, dailyTime: e.target.value })} className={inputClass} />
            </div>
          )}

          {value.type === 'weekly' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((d, i) => (
                  <button key={d} onClick={() => onChange({ ...value, weeklyDay: i })}
                    className={`px-2.5 py-1.5 rounded text-xs border ${value.weeklyDay === i ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-white/40 border-white/[0.06]'}`}>
                    {t(`schedules.${d}`).slice(0, 3)}
                  </button>
                ))}
              </div>
              <input type="time" value={value.weeklyTime} onChange={e => onChange({ ...value, weeklyTime: e.target.value })} className={inputClass} />
            </div>
          )}

          {value.type === 'monthly' && (
            <div className="space-y-2">
              <input type="number" min={1} max={28} value={value.monthlyDay} onChange={e => onChange({ ...value, monthlyDay: parseInt(e.target.value) || 1 })}
                placeholder={t('schedules.dayOfMonth')} className={inputClass} />
              <input type="time" value={value.monthlyTime} onChange={e => onChange({ ...value, monthlyTime: e.target.value })} className={inputClass} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Job
// ---------------------------------------------------------------------------

function StepJob({ value, onChange, t }: {
  value: { name: string; retainCount: number; model: string }
  onChange: (v: typeof value) => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-white/80 mb-1">{t('dashboard.wizardStepJob')}</div>
        <div className="text-xs text-white/40">{t('dashboard.wizardStepJobDesc')}</div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-white/50 mb-1 block">{t('jobs.name')}</label>
          <input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="My Backup Job" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-white/50 mb-1 block">{t('jobs.retainCount')}</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 7, 14].map(n => (
              <button key={n} onClick={() => onChange({ ...value, retainCount: n })}
                className={`px-3 py-1.5 rounded text-xs border ${value.retainCount === n ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-white/40 border-white/[0.06]'}`}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-white/50 mb-1 block">{t('jobs.model')}</label>
          <input value={value.model} onChange={e => onChange({ ...value, model: e.target.value })} placeholder={t('jobs.modelOptional')} className={inputClass} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard main
// ---------------------------------------------------------------------------

export function BackupWizard({ onClose }: { onClose: () => void }) {
  const t = useTranslations('backup')
  const queryClient = useQueryClient()
  const [step, setStep] = useState<WizardStep>('dest')
  const [error, setError] = useState('')

  // Step state
  const [dest, setDest] = useState({
    mode: 'existing' as 'existing' | 'new', id: '', name: '', type: 'local' as 'ftp' | 'local',
    localPath: '~/backup', ftpIp: '', ftpPort: '21', ftpUser: '', ftpPass: '', ftpMode: 'passive' as 'active' | 'passive', ftpPath: '/',
  })
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [includeOpenClaw, setIncludeOpenClaw] = useState(true)
  const [sched, setSched] = useState({
    mode: 'existing' as 'existing' | 'new', id: '', name: '', type: 'daily',
    hourlyInterval: 2, dailyDays: [1, 2, 3, 4, 5], dailyTime: '03:00', weeklyDay: 0, weeklyTime: '03:00', monthlyDay: 1, monthlyTime: '03:00',
  })
  const [job, setJob] = useState({ name: '', retainCount: 7, model: '' })

  // Mutations
  const createDest = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetch('/api/backup/destinations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  })
  const createSchedule = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetch('/api/backup/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  })
  const createJob = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetch('/api/backup/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  })

  const stepIdx = STEPS.indexOf(step)

  function canNext(): boolean {
    if (step === 'dest') {
      if (dest.mode === 'existing') return !!dest.id
      return !!dest.name
    }
    if (step === 'source') return includeOpenClaw || sourceIds.length > 0
    if (step === 'schedule') {
      if (sched.mode === 'existing') return !!sched.id
      return !!sched.name
    }
    if (step === 'job') return !!job.name
    return false
  }

  async function handleNext() {
    setError('')
    if (step === 'job') {
      // Final step — create everything
      try {
        let destId = dest.id
        if (dest.mode === 'new') {
          const config = dest.type === 'local'
            ? { path: dest.localPath }
            : { ip: dest.ftpIp, port: parseInt(dest.ftpPort), user: dest.ftpUser, password: dest.ftpPass, mode: dest.ftpMode, path: dest.ftpPath }
          const res = await createDest.mutateAsync({ name: dest.name, type: dest.type, config })
          if (!res.ok) { setError(res.error || 'Failed'); return }
          destId = res.id
        }

        let schedId = sched.id
        if (sched.mode === 'new') {
          let config: Record<string, unknown> = {}
          if (sched.type === 'hourly') config = { interval: sched.hourlyInterval }
          else if (sched.type === 'daily') config = { days: sched.dailyDays, time: sched.dailyTime }
          else if (sched.type === 'weekly') config = { day: sched.weeklyDay, time: sched.weeklyTime }
          else if (sched.type === 'monthly') config = { dayOfMonth: sched.monthlyDay, time: sched.monthlyTime }
          const res = await createSchedule.mutateAsync({ name: sched.name, type: sched.type, config })
          if (!res.ok) { setError(res.error || 'Failed'); return }
          schedId = res.id
        }

        const res = await createJob.mutateAsync({
          name: job.name, destinationId: destId, scheduleId: schedId,
          retainCount: job.retainCount, sourceIds, includeOpenClaw, model: job.model || null,
        })
        if (!res.ok) { setError(res.error || 'Failed'); return }

        queryClient.invalidateQueries({ queryKey: ['backup-dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['backup-destinations'] })
        queryClient.invalidateQueries({ queryKey: ['backup-schedules'] })
        queryClient.invalidateQueries({ queryKey: ['backup-jobs'] })
        setStep('done')
      } catch (err) {
        setError(String(err))
      }
      return
    }
    setStep(STEPS[stepIdx + 1])
  }

  if (step === 'done') {
    return (
      <div className="cyber-card p-6">
        <div className="flex flex-col items-center text-center py-8 gap-4">
          <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <div className="text-lg font-semibold text-white">{t('dashboard.wizardDone')}</div>
          <div className="text-sm text-white/50">{t('dashboard.wizardDoneDesc')}</div>
          <button onClick={onClose} className={btnPrimary}>{t('common.close')}</button>
        </div>
      </div>
    )
  }

  const isSubmitting = createDest.isPending || createSchedule.isPending || createJob.isPending

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-cyan-400" />
          <span className="text-sm font-semibold text-white">{t('dashboard.wizard')}</span>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <StepIndicator current={step} t={t} />

      {/* Content */}
      <div className="min-h-[280px]">
        {step === 'dest' && <StepDest value={dest} onChange={setDest} t={t} />}
        {step === 'source' && <StepSource selected={sourceIds} onChange={setSourceIds} openClaw={includeOpenClaw} onOpenClawChange={setIncludeOpenClaw} t={t} />}
        {step === 'schedule' && <StepSchedule value={sched} onChange={setSched} t={t} />}
        {step === 'job' && <StepJob value={job} onChange={setJob} t={t} />}
      </div>

      {/* Error */}
      {error && <div className="text-red-400 text-xs mt-2">{error}</div>}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/[0.06]">
        <button onClick={() => stepIdx > 0 ? setStep(STEPS[stepIdx - 1]) : onClose}
          className={btnSecondary}>
          <ChevronLeft className="w-3 h-3" />
          {stepIdx > 0 ? t('dashboard.wizardPrev') : t('common.cancel')}
        </button>
        <div className="text-[11px] text-white/30">
          {t('dashboard.wizardStep', { step: stepIdx + 1, total: STEPS.length })}
        </div>
        <button onClick={handleNext} disabled={!canNext() || isSubmitting}
          className={`${btnPrimary} ${(!canNext() || isSubmitting) ? 'opacity-40 pointer-events-none' : ''}`}>
          {step === 'job' ? t('dashboard.wizardFinish') : t('dashboard.wizardNext')}
          {step !== 'job' && <ChevronRight className="w-3 h-3" />}
        </button>
      </div>
    </div>
  )
}
