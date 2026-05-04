'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import * as Switch from '@radix-ui/react-switch'
import {
  Plug,
  Save,
  Power,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Clock,
  MessageSquareOff,
  Pause,
  Play,
} from 'lucide-react'
import { LinePatchCard } from './line-patch-card'

type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

interface ScheduleWindow {
  days: Day[]
  start: string
  end: string
}

interface GateConfig {
  schedule: { timezone: string; windows: ScheduleWindow[] }
  replyText: string
  channels: string[]
  pauseAi: boolean
}

interface GateStatus {
  installed: boolean
  enabled: boolean
  pluginSourceDir: string
  config: GateConfig
}

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

const KNOWN_CHANNELS = ['line', 'telegram', 'discord', 'slack', 'whatsapp', 'messenger']

export function BusinessHoursTab() {
  const t = useTranslations('customerService')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<GateStatus>({
    queryKey: ['customer-service-status'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service')
      if (!res.ok) throw new Error('fetch status failed')
      return res.json()
    },
    refetchInterval: 15000,
  })

  const [draft, setDraft] = useState<GateConfig | null>(null)
  const [busy, setBusy] = useState<'install' | 'uninstall' | 'save' | 'pause' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [output, setOutput] = useState<string>('')

  useEffect(() => {
    if (data?.config && draft === null) {
      setDraft(data.config)
    }
  }, [data, draft])

  const dirty = useMemo(() => {
    if (!data?.config || !draft) return false
    return JSON.stringify(data.config) !== JSON.stringify(draft)
  }, [data, draft])

  async function callAction(action: string, extra: Record<string, unknown> = {}) {
    const tag = action === 'install'
      ? 'install'
      : action === 'uninstall'
        ? 'uninstall'
        : action === 'pause-toggle'
          ? 'pause'
          : 'save'
    setBusy(tag)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      const messageKey = `messages.${action}Success`
      setMessage({ type: 'success', text: t.has(messageKey) ? t(messageKey) : t('messages.saveSuccess') })
      if (typeof json?.output === 'string') setOutput(json.output)
      queryClient.invalidateQueries({ queryKey: ['customer-service-status'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.genericError') })
    } finally {
      setBusy(null)
    }
  }

  async function togglePauseAi(nextActive?: boolean) {
    if (!draft) return
    // Switch.onCheckedChange passes the new "checked" state (true = AI on).
    // Button click (no arg) toggles current state.
    const newPause = typeof nextActive === 'boolean' ? !nextActive : !draft.pauseAi
    const next = { ...draft, pauseAi: newPause }
    setDraft(next)
    setBusy('pause')
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-and-restart', config: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t('messages.pauseToggleApplied') })
      if (typeof json?.output === 'string') setOutput(json.output)
      queryClient.invalidateQueries({ queryKey: ['customer-service-status'] })
    } catch (err: any) {
      // revert optimistic state
      setDraft(draft)
      setMessage({ type: 'error', text: err?.message ?? t('messages.genericError') })
    } finally {
      setBusy(null)
    }
  }

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
      {/* Master AI on/off */}
      <div className={`cyber-card p-5 border ${paused ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-emerald-500/25 bg-emerald-500/[0.03]'}`}>
        <div className="flex items-center gap-4">
          <div className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${paused ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
            {paused ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </div>
          <div className="flex-1">
            <h3 className={`text-base font-semibold ${paused ? 'text-amber-200' : 'text-emerald-200'}`}>
              {paused ? t('master.paused') : t('master.active')}
            </h3>
            <p className="text-sm text-white/60 mt-0.5 leading-relaxed">
              {paused ? t('master.pausedDesc') : t('master.activeDesc')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {busy === 'pause' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-cyan-300 mr-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('master.applying')}
              </span>
            )}
            <span className={`text-xs font-medium uppercase tracking-wider ${paused ? 'text-white/40' : 'text-emerald-300'}`}>
              {t('master.toggleOn')}
            </span>
            <Switch.Root
              checked={!paused}
              onCheckedChange={togglePauseAi}
              disabled={busy !== null || !data?.installed}
              aria-label={paused ? t('master.resume') : t('master.pause')}
              className="relative h-7 w-14 shrink-0 cursor-pointer rounded-full border transition-colors
                disabled:cursor-not-allowed disabled:opacity-60
                data-[state=checked]:bg-emerald-500/30 data-[state=checked]:border-emerald-500/50
                data-[state=unchecked]:bg-amber-500/20 data-[state=unchecked]:border-amber-500/40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Switch.Thumb className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full shadow-lg ring-0 transition-all
                bg-white
                data-[state=checked]:translate-x-[1.875rem] data-[state=checked]:bg-emerald-300
                data-[state=unchecked]:translate-x-1 data-[state=unchecked]:bg-amber-300">
                {busy === 'pause' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-white/80" />
                ) : paused ? (
                  <Pause className="w-3 h-3 text-amber-900" />
                ) : (
                  <Play className="w-3 h-3 text-emerald-900" />
                )}
              </Switch.Thumb>
            </Switch.Root>
            <span className={`text-xs font-medium uppercase tracking-wider ${paused ? 'text-amber-300' : 'text-white/40'}`}>
              {t('master.toggleOff')}
            </span>
          </div>
        </div>
        {!data?.installed && (
          <p className="text-xs text-white/40 mt-3 ml-16">{t('master.needsInstall')}</p>
        )}
      </div>

      {/* LINE async-ack patch + drop-in status */}
      <LinePatchCard />

      {/* Status + install controls */}
      <div className="cyber-card p-5">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
          {t('pluginStatus')}
        </h3>
        <div className="grid grid-cols-1 gap-2 mb-4">
          <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/40">{t('pluginInfo.name')}</div>
              <div className="text-sm font-mono text-white/90 mt-0.5">business-hours-gate</div>
            </div>
            <span className="text-xs text-white/40 font-mono">v0.1.0</span>
          </div>
          {data?.pluginSourceDir && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-white/40">{t('pluginInfo.path')}</div>
              <div className="text-[12px] font-mono text-white/80 mt-0.5 break-all">{data.pluginSourceDir}</div>
              <div className="text-[11px] text-white/40 mt-1">{t('pluginInfo.pathHint')}</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <StatusBadge label={t('installed')} ok={data?.installed ?? false} />
          <StatusBadge label={t('enabled')} ok={data?.enabled ?? false} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!data?.installed ? (
            <button
              onClick={() => callAction('install')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
                disabled:opacity-50 transition-colors"
            >
              {busy === 'install' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {t('actions.install')}
            </button>
          ) : (
            <button
              onClick={() => callAction('uninstall')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20
                disabled:opacity-50 transition-colors"
            >
              {busy === 'uninstall' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {t('actions.uninstall')}
            </button>
          )}
        </div>
        {output && (
          <pre className="mt-4 max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap">
            {output}
          </pre>
        )}
      </div>

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

      {/* Reply text */}
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquareOff className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('reply.title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('reply.description')}</p>
        <textarea
          value={draft.replyText}
          onChange={(e) => setDraft({ ...draft, replyText: e.target.value })}
          placeholder={t('reply.placeholder')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
        />
      </div>

      {/* Channels */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/90">{t('channels.title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed">{t('channels.description')}</p>
        <div className="flex flex-wrap gap-2">
          {KNOWN_CHANNELS.map((channel) => {
            const checked = draft.channels.includes(channel)
            return (
              <label
                key={channel}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
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
                      ? [...draft.channels, channel]
                      : draft.channels.filter((c) => c !== channel)
                    setDraft({ ...draft, channels: next })
                  }}
                />
                {channel}
              </label>
            )
          })}
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

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <span className="text-xs text-white/60">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-white/40">
          <XCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  )
}
