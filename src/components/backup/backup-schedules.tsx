'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Clock, Plus, Pencil, Trash2, X, Check } from 'lucide-react'

type ScheduleType = 'hourly' | 'daily' | 'weekly' | 'monthly'

interface BackupSchedule {
  id: string
  name: string
  type: ScheduleType
  config: string
  jobsAssigned: number
  createdAt: number
  updatedAt: number
}

interface HourlyConfig {
  interval: number
}
interface DailyConfig {
  days: number[]
  time: string
}
interface WeeklyConfig {
  day: number
  time: string
}
interface MonthlyConfig {
  dayOfMonth: number
  time: string
}

type ScheduleConfig = HourlyConfig | DailyConfig | WeeklyConfig | MonthlyConfig

const HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12]
const DAYS_OF_WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function parseConfig(type: ScheduleType, configStr: string): ScheduleConfig {
  try {
    return JSON.parse(configStr)
  } catch {
    if (type === 'hourly') return { interval: 1 }
    if (type === 'daily') return { days: [1, 2, 3, 4, 5], time: '03:00' }
    if (type === 'weekly') return { day: 1, time: '03:00' }
    return { dayOfMonth: 1, time: '03:00' }
  }
}

function defaultConfig(type: ScheduleType): ScheduleConfig {
  if (type === 'hourly') return { interval: 1 }
  if (type === 'daily') return { days: [1, 2, 3, 4, 5], time: '03:00' }
  if (type === 'weekly') return { day: 1, time: '03:00' }
  return { dayOfMonth: 1, time: '03:00' }
}

function ScheduleDescription({
  type,
  config,
  t,
}: {
  type: ScheduleType
  config: ScheduleConfig
  t: ReturnType<typeof useTranslations<'backup.schedules'>>
}) {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

  if (type === 'hourly') {
    const c = config as HourlyConfig
    if (c.interval === 1) return <span>{t('everyHour')}</span>
    return <span>{t('everyNHours', { n: c.interval })}</span>
  }

  if (type === 'daily') {
    const c = config as DailyConfig
    const dayLabels = (c.days ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map(d => t(dayNames[d]).slice(0, 3))
      .join(', ')
    return <span>{dayLabels} {t('time').toLowerCase()} {c.time}</span>
  }

  if (type === 'weekly') {
    const c = config as WeeklyConfig
    return <span>{t(dayNames[c.day])} {t('time').toLowerCase()} {c.time}</span>
  }

  if (type === 'monthly') {
    const c = config as MonthlyConfig
    const day = c.dayOfMonth
    const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'
    return <span>{day}{suffix} {t('time').toLowerCase()} {c.time}</span>
  }

  return null
}

interface FormState {
  name: string
  type: ScheduleType
  config: ScheduleConfig
}

function defaultFormState(): FormState {
  return { name: '', type: 'daily', config: defaultConfig('daily') }
}

function ScheduleModal({
  initial,
  onSave,
  onClose,
  isPending,
  t,
  tc,
}: {
  initial: FormState
  onSave: (form: FormState) => void
  onClose: () => void
  isPending: boolean
  t: ReturnType<typeof useTranslations<'backup.schedules'>>
  tc: ReturnType<typeof useTranslations<'common'>>
}) {
  const [name, setName] = useState(initial.name)
  const [type, setType] = useState<ScheduleType>(initial.type)
  const [config, setConfig] = useState<ScheduleConfig>(initial.config)

  function handleTypeChange(newType: ScheduleType) {
    setType(newType)
    setConfig(defaultConfig(newType))
  }

  function handleSave() {
    if (!name.trim()) return
    onSave({ name: name.trim(), type, config })
  }

  const hourlyConfig = config as HourlyConfig
  const dailyConfig = config as DailyConfig
  const weeklyConfig = config as WeeklyConfig
  const monthlyConfig = config as MonthlyConfig

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md mx-4 cyber-card p-6 space-y-5 border-cyan-500/30">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
            {initial.name ? tc('edit') : t('addNew')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded text-white/40 hover:text-white/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
            {t('name')}
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
            placeholder={t('name')}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
            {t('type')}
          </label>
          <select
            value={type}
            onChange={e => handleTypeChange(e.target.value as ScheduleType)}
            className="w-full bg-[#0a0f1a] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="hourly">{t('hourly')}</option>
            <option value="daily">{t('daily')}</option>
            <option value="weekly">{t('weekly')}</option>
            <option value="monthly">{t('monthly')}</option>
          </select>
        </div>

        {/* Config: Hourly */}
        {type === 'hourly' && (
          <div>
            <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-2">
              {t('everyNHours', { n: '' }).trim()}
            </label>
            <div className="flex flex-wrap gap-2">
              {HOURLY_INTERVALS.map(n => (
                <label
                  key={n}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border cursor-pointer transition-colors ${
                    hourlyConfig.interval === n
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                      : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="interval"
                    value={n}
                    checked={hourlyConfig.interval === n}
                    onChange={() => setConfig({ interval: n })}
                    className="sr-only"
                  />
                  {n === 1 ? t('everyHour') : t('everyNHours', { n })}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Config: Daily */}
        {type === 'daily' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-2">
                {t('days')}
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((day, idx) => {
                  const checked = (dailyConfig.days ?? []).includes(idx)
                  return (
                    <label
                      key={day}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                          : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/20'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const prev = dailyConfig.days ?? []
                          const next = checked
                            ? prev.filter(d => d !== idx)
                            : [...prev, idx].sort((a, b) => a - b)
                          setConfig({ ...dailyConfig, days: next })
                        }}
                        className="sr-only"
                      />
                      {t(day).slice(0, 3)}
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('time')}
              </label>
              <input
                type="time"
                value={dailyConfig.time}
                onChange={e => setConfig({ ...dailyConfig, time: e.target.value })}
                className="bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>
        )}

        {/* Config: Weekly */}
        {type === 'weekly' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-2">
                {t('dayOfWeek')}
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((day, idx) => (
                  <label
                    key={day}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
                      weeklyConfig.day === idx
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                        : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/20'
                    }`}
                  >
                    <input
                      type="radio"
                      name="weekday"
                      value={idx}
                      checked={weeklyConfig.day === idx}
                      onChange={() => setConfig({ ...weeklyConfig, day: idx })}
                      className="sr-only"
                    />
                    {t(day).slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('time')}
              </label>
              <input
                type="time"
                value={weeklyConfig.time}
                onChange={e => setConfig({ ...weeklyConfig, time: e.target.value })}
                className="bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>
        )}

        {/* Config: Monthly */}
        {type === 'monthly' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('dayOfMonth')} (1–28)
              </label>
              <input
                type="number"
                min={1}
                max={28}
                value={monthlyConfig.dayOfMonth}
                onChange={e => {
                  const v = Math.min(28, Math.max(1, parseInt(e.target.value) || 1))
                  setConfig({ ...monthlyConfig, dayOfMonth: v })
                }}
                className="w-24 bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('time')}
              </label>
              <input
                type="time"
                value={monthlyConfig.time}
                onChange={e => setConfig({ ...monthlyConfig, time: e.target.value })}
                className="bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {tc('save')}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-white/50 hover:text-white/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            {tc('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function BackupSchedules() {
  const t = useTranslations('backup.schedules')
  const tc = useTranslations('common')
  const queryClient = useQueryClient()

  const [modalForm, setModalForm] = useState<(FormState & { id?: string }) | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data: schedules = [], isLoading, isError } = useQuery<BackupSchedule[]>({
    queryKey: ['backup-schedules'],
    queryFn: async () => {
      const res = await fetch('/api/backup/schedules')
      if (!res.ok) throw new Error('Failed to fetch schedules')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; type: ScheduleType; config: string }) => {
      const res = await fetch('/api/backup/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create schedule')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-schedules'] })
      setModalForm(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (body: { id: string; name?: string; type?: ScheduleType; config?: string }) => {
      const res = await fetch('/api/backup/schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to update schedule')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-schedules'] })
      setModalForm(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backup/schedules?id=${id}`, { method: 'DELETE' })
      if (res.status === 409) {
        throw new Error('blocked')
      }
      if (!res.ok) throw new Error('Failed to delete schedule')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-schedules'] })
      setDeleteConfirmId(null)
      setDeleteError(null)
    },
    onError: (err: Error) => {
      if (err.message === 'blocked') {
        setDeleteError(t('deleteBlocked'))
      } else {
        setDeleteError(err.message)
      }
    },
  })

  function handleOpenCreate() {
    setModalForm(defaultFormState())
  }

  function handleOpenEdit(schedule: BackupSchedule) {
    setModalForm({
      id: schedule.id,
      name: schedule.name,
      type: schedule.type,
      config: parseConfig(schedule.type, schedule.config),
    })
  }

  function handleSave(form: FormState) {
    const configStr = JSON.stringify(form.config)
    if (modalForm?.id != null) {
      updateMutation.mutate({ id: modalForm.id, name: form.name, type: form.type, config: configStr })
    } else {
      createMutation.mutate({ name: form.name, type: form.type, config: configStr })
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      {/* Modal */}
      {modalForm && (
        <ScheduleModal
          initial={modalForm}
          onSave={handleSave}
          onClose={() => setModalForm(null)}
          isPending={isSaving}
          t={t}
          tc={tc}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/60 uppercase tracking-wider">
          {t('title')}
        </h2>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('addNew')}
        </button>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="text-white/40 text-sm font-mono px-1">{tc('loading')}</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm font-mono px-1">{tc('error')}</div>
      )}

      {/* Table */}
      {!isLoading && !isError && schedules.length === 0 && (
        <div className="text-white/30 text-sm font-mono px-1 py-6 text-center">—</div>
      )}

      {!isLoading && !isError && schedules.length > 0 && (
        <div className="cyber-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-4 py-2.5 text-[11px] text-white/40 uppercase tracking-wider font-medium">
                  {t('name')}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] text-white/40 uppercase tracking-wider font-medium hidden sm:table-cell">
                  {t('type')}
                </th>
                <th className="text-center px-4 py-2.5 text-[11px] text-white/40 uppercase tracking-wider font-medium hidden md:table-cell">
                  {t('jobsAssigned')}
                </th>
                <th className="px-4 py-2.5 w-24" />
              </tr>
            </thead>
            <tbody>
              {schedules.map(schedule => {
                const isConfirmingDelete = deleteConfirmId === schedule.id
                const parsedConfig = parseConfig(schedule.type, schedule.config)

                return (
                  <tr
                    key={schedule.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Name + mobile description */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-cyan-400/60 shrink-0" />
                        <div>
                          <div className="text-white font-medium">{schedule.name}</div>
                          <div className="text-[11px] text-white/40 sm:hidden mt-0.5">
                            <ScheduleDescription type={schedule.type} config={parsedConfig} t={t} />
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Type description */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="text-[12px] text-white/60">
                        <ScheduleDescription type={schedule.type} config={parsedConfig} t={t} />
                      </div>
                      <div className="text-[11px] text-cyan-400/50 mt-0.5">
                        {t(schedule.type)}
                      </div>
                    </td>

                    {/* Jobs assigned */}
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      <span className={`text-sm font-mono ${schedule.jobsAssigned > 0 ? 'text-cyan-300' : 'text-white/30'}`}>
                        {schedule.jobsAssigned}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isConfirmingDelete ? (
                          <>
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => deleteMutation.mutate(schedule.id)}
                                  disabled={deleteMutation.isPending}
                                  className="px-2 py-1 rounded text-[11px] bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                                >
                                  {tc('delete')}
                                </button>
                                <button
                                  onClick={() => { setDeleteConfirmId(null); setDeleteError(null) }}
                                  className="px-2 py-1 rounded text-[11px] text-white/40 hover:text-white/60 transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              {deleteError && (
                                <span className="text-[10px] text-red-400 max-w-[140px] text-right leading-tight">
                                  {deleteError}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleOpenEdit(schedule)}
                              className="p-1.5 rounded text-white/30 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                              title={tc('edit')}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setDeleteConfirmId(schedule.id); setDeleteError(null) }}
                              className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title={tc('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
