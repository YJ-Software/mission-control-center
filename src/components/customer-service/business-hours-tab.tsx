'use client'

import { useTranslations } from 'next-intl'
import {
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Clock,
} from 'lucide-react'
import { useBusinessHours, type Day, type ScheduleWindow } from './business-hours-context'

const DAYS: { key: Day; labelKey: string }[] = [
  { key: 'mon', labelKey: 'days.mon' },
  { key: 'tue', labelKey: 'days.tue' },
  { key: 'wed', labelKey: 'days.wed' },
  { key: 'thu', labelKey: 'days.thu' },
  { key: 'fri', labelKey: 'days.fri' },
  { key: 'sat', labelKey: 'days.sat' },
  { key: 'sun', labelKey: 'days.sun' },
]

const TIMEZONES = [
  'Asia/Taipei',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'UTC',
]

export function BusinessHoursTab() {
  const t = useTranslations('customerService')
  const { draft, setDraft, dirty, busy, message, callAction, isLoading } = useBusinessHours()

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center p-12 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const paused = draft.pauseAi

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Schedule editor */}
      <div className={`cyber-card p-5 space-y-4 ${paused ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('schedule.title')}</h3>
          {paused && (
            <span className="ml-auto text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
              {t('schedule.overriddenByPause')}
            </span>
          )}
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('schedule.description')}</p>

        {/* Timezone */}
        <div>
          <label className="block text-xs text-white/60 mb-1">{t('schedule.timezone')}</label>
          <select
            value={draft.schedule.timezone}
            onChange={(e) =>
              setDraft({ ...draft, schedule: { ...draft.schedule, timezone: e.target.value } })
            }
            style={{ colorScheme: 'dark' }}
            className="w-full sm:w-64 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz} className="bg-[#0f1115] text-white/90">
                {tz}
              </option>
            ))}
          </select>
        </div>

        {/* Windows */}
        <div className="space-y-3">
          {draft.schedule.windows.map((win, idx) => (
            <WindowEditor
              key={idx}
              t={t}
              window={win}
              onChange={(next) => {
                const windows = [...draft.schedule.windows]
                windows[idx] = next
                setDraft({ ...draft, schedule: { ...draft.schedule, windows } })
              }}
              onRemove={() => {
                const windows = draft.schedule.windows.filter((_, i) => i !== idx)
                setDraft({ ...draft, schedule: { ...draft.schedule, windows } })
              }}
            />
          ))}
          <button
            onClick={() => {
              setDraft({
                ...draft,
                schedule: {
                  ...draft.schedule,
                  windows: [
                    ...draft.schedule.windows,
                    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' },
                  ],
                },
              })
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium
              bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.08]"
          >
            <Plus className="w-3 h-3" />
            {t('schedule.addWindow')}
          </button>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => callAction('save-and-restart', { config: draft })}
          disabled={busy !== null || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
            disabled:opacity-50 transition-colors"
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('actions.save')}
        </button>
        {dirty && <span className="text-xs text-amber-300">{t('messages.unsaved')}</span>}
      </div>

      {/* Message strip */}
      {message && (
        <div
          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
            message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}
    </div>
  )
}

function WindowEditor({
  t,
  window: win,
  onChange,
  onRemove,
}: {
  t: ReturnType<typeof useTranslations>
  window: ScheduleWindow
  onChange: (next: ScheduleWindow) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d) => {
          const checked = win.days.includes(d.key)
          return (
            <label
              key={d.key}
              className={`inline-flex items-center justify-center w-9 h-9 rounded text-xs font-medium border cursor-pointer transition-colors ${
                checked
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25'
                  : 'bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]'
              }`}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...win.days, d.key]
                    : win.days.filter((x) => x !== d.key)
                  onChange({ ...win, days: next })
                }}
              />
              {t(d.labelKey)}
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="time"
          value={win.start}
          onChange={(e) => onChange({ ...win, start: e.target.value })}
          className="px-2 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
        />
        <span className="text-white/40">—</span>
        <input
          type="time"
          value={win.end}
          onChange={(e) => onChange({ ...win, end: e.target.value })}
          className="px-2 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
        />
        <button
          onClick={onRemove}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="w-3 h-3" />
          {t('schedule.removeWindow')}
        </button>
      </div>
    </div>
  )
}
